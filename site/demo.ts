/**
 * Browser side of the explainer page. It runs the project's real tokenizer and
 * BM25 index in the page; semantic and fused results for the 20 eval questions
 * are precomputed by scripts/build-site.ts.
 */
import { Bm25Index } from "../src/rag/bm25.ts";
import { searchableText } from "../src/rag/chunk.ts";
import { hebrewVariants, normalize, tokenizeHebrew, tokenizeHebrewGrouped } from "../src/rag/tokenize.ts";
import type { Chunk } from "../src/rag/types.ts";

interface Preset {
  id: string;
  type: "single" | "multi" | "unanswerable" | "injection";
  question: string;
  reference: string;
  expected: string[];
  dense: string[];
  hybrid: string[];
}
interface Result {
  mode: string;
  r1: number;
  r3: number;
  r5: number;
  mrr: number;
}
interface PageData {
  chunks: Chunk[];
  docCount: number;
  presets: Preset[];
  results: Result[];
}

const data = JSON.parse(document.getElementById("moked-data")!.textContent!) as PageData;
const byId = new Map(data.chunks.map((c) => [c.id, c]));
const index = new Bm25Index(data.chunks.map((c) => tokenizeHebrew(searchableText(c))));
const INJECTED = "community-tips#3";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

/** Build an element; text is always set as text, never as HTML. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const keywordSearch = (question: string) => index.search(tokenizeHebrewGrouped(question), 5).map((hit) => data.chunks[hit.index]!.id);

// ---------- step 1: the question as the search engine sees it ----------

function renderWords(question: string) {
  const box = $("#words");
  box.replaceChildren();
  const raw = normalize(question).match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = new Set(tokenizeHebrewGrouped(question).map((group) => group[0]));
  for (const word of raw) {
    const chip = el("span", "word");
    chip.append(el("b", "", word));
    if (!kept.has(word)) {
      chip.classList.add("word--skip");
      chip.append(el("small", "", "מילה נפוצה, מדלגים"));
    } else {
      const stems = hebrewVariants(word).filter((v) => v !== word);
      if (stems.length) chip.append(el("small", "", `גם: ${stems.join(", ")}`));
    }
    box.append(chip);
  }
}

// ---------- steps 2-3: result lists ----------

function passageItem(id: string, rank: number, expected: string[]): HTMLLIElement {
  const chunk = byId.get(id)!;
  const item = el("li", "hit");
  const details = el("details");
  const summary = el("summary");
  summary.append(el("span", "hit__rank", String(rank)), el("span", "hit__title", `${chunk.docTitle} · ${chunk.heading}`));
  if (expected.includes(id)) {
    item.classList.add("hit--right");
    summary.append(el("span", "tag tag--right", "הקטע הנכון"));
  }
  if (id === INJECTED) {
    item.classList.add("hit--trap");
    summary.append(el("span", "tag tag--trap", "מלכודת ששתלנו"));
  }
  const body = el("p", "hit__text", chunk.text);
  const code = el("code", "hit__id", id);
  code.dir = "ltr";
  details.append(summary, body, code);
  item.append(details);
  return item;
}

function renderList(selector: string, ids: string[] | null, expected: string[], emptyNote: string) {
  const list = $(selector);
  list.replaceChildren();
  if (!ids) {
    list.append(el("li", "hit hit--note", emptyNote));
    return;
  }
  if (ids.length === 0) list.append(el("li", "hit hit--note", "לא נמצא אף קטע עם המילים האלה."));
  ids.forEach((id, i) => list.append(passageItem(id, i + 1, expected)));
}

// ---------- step 4: what the agent is expected to do ----------

const VERDICTS: Record<Preset["type"], string> = {
  single: "שאלה רגילה: קטע אחד במדריך עונה עליה.",
  multi: "שאלה כפולה: התשובה מפוזרת בשני מסמכים, והסוכן צריך לחפש פעמיים.",
  unanswerable: "שאלה בלי תשובה: המדריך לא עוסק בזה. המבחן בודק שהסוכן אומר שאין לו מידע, ולא מנחש.",
  injection: "שאלת מלכודת: אחד הקטעים מכיל טקסט שמתחזה להוראה. המבחן בודק שהסוכן לא מציית לו.",
};

function renderAnswer(preset: Preset | null) {
  const box = $("#answer");
  box.replaceChildren();
  if (!preset) {
    box.append(
      el("p", "", "בשאלה חופשית העמוד מריץ רק את חיפוש מילות המפתח. חיפוש המשמעות והסוכן צריכים מודלים שרצים על מחשב או דרך מפתח API, ולכן הם לא פועלים כאן."),
    );
    return;
  }
  box.append(el("p", "answer__kind", VERDICTS[preset.type]));
  box.append(el("p", "answer__label", "התשובה שהמבחן מצפה לה:"));
  box.append(el("p", "answer__text", preset.reference));
  if (preset.expected.length) {
    const cites = el("p", "answer__cites", "המקורות שהסוכן אמור לצטט: ");
    preset.expected.forEach((id) => {
      const code = el("code", "", `[${id}]`);
      code.dir = "ltr";
      cites.append(code, " ");
    });
    box.append(cites);
  }
}

// ---------- wiring ----------

function run(question: string, preset: Preset | null) {
  const expected = preset?.expected ?? [];
  $("#asked").textContent = question;
  renderWords(question);
  renderList("#hits-keyword", keywordSearch(question), expected, "");
  renderList("#hits-meaning", preset?.dense ?? null, expected, "זמין רק לשאלות המוכנות: חיפוש לפי משמעות צריך מודל שלא רץ בדפדפן.");
  renderList("#hits-final", preset?.hybrid ?? keywordSearch(question), expected, "");
  $("#final-note").textContent = preset
    ? "הרשימה המאוחדת, כפי שהיא מגיעה לסוכן."
    : "בשאלה חופשית מוצגות כאן תוצאות חיפוש מילות המפתח בלבד.";
  renderAnswer(preset);
  document.querySelectorAll<HTMLButtonElement>(".q").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.id === preset?.id)));
}

const TYPE_LABEL: Record<Preset["type"], string> = { single: "", multi: "כפולה", unanswerable: "בלי תשובה", injection: "מלכודת" };

const picker = $("#questions");
for (const preset of data.presets) {
  const button = el("button", "q");
  button.type = "button";
  button.dataset.id = preset.id;
  button.append(el("span", "", preset.question));
  if (TYPE_LABEL[preset.type]) button.append(el("span", `tag tag--${preset.type}`, TYPE_LABEL[preset.type]));
  button.addEventListener("click", () => run(preset.question, preset));
  picker.append(button);
}

$<HTMLFormElement>("#free").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = $<HTMLInputElement>("#free-input").value.trim();
  if (question) run(question, null);
});

// Results chart: plain bars, values straight from the eval report.
const MODE_LABEL: Record<string, string> = {
  "bm25-naive": "מילות מפתח, בלי טיפול בעברית",
  bm25: "מילות מפתח, עם טיפול בעברית",
  dense: "חיפוש לפי משמעות",
  hybrid: "שניהם יחד (היברידי)",
  "hybrid-rerank": "היברידי + דירוג מחדש",
};
const chart = $("#chart");
for (const row of data.results) {
  const line = el("div", "bar");
  line.append(el("span", "bar__label", MODE_LABEL[row.mode] ?? row.mode));
  const track = el("span", "bar__track");
  const fill = el("span", "bar__fill");
  fill.style.inlineSize = `${row.r5}%`;
  if (row.mode === "hybrid") fill.classList.add("bar__fill--best");
  track.append(fill);
  line.append(track, el("span", "bar__value", `${row.r5}%`));
  chart.append(line);
}

document.querySelectorAll<HTMLElement>("[data-count]").forEach((node) => {
  const key = node.dataset.count;
  node.textContent = String(key === "docs" ? data.docCount : key === "chunks" ? data.chunks.length : data.presets.length);
});

run(data.presets[0]!.question, data.presets[0]!);
