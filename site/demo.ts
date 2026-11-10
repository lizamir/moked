/**
 * Browser side of the explainer page. It runs the project's real tokenizer and
 * BM25 index in the page; semantic and fused results for the 20 eval scenarios
 * are precomputed by scripts/build-site.ts.
 */
import { Bm25Index } from "../src/rag/bm25.ts";
import { searchableText } from "../src/rag/chunk.ts";
import { hebrewVariants, normalize, tokenizeHebrew, tokenizeHebrewGrouped } from "../src/rag/tokenize.ts";
import type { Chunk } from "../src/rag/types.ts";

type ScenarioType = "kb" | "web" | "action" | "multi" | "boundary";
interface Preset {
  id: string;
  type: ScenarioType;
  question: string;
  followUps: string[];
  behavior: string;
  approve: boolean;
  tools: string[];
  noTools: string[];
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

const KIND: Record<ScenarioType, string> = {
  kb: "שאלה שהתשובה שלה נמצאת במאגר הידע של העסק.",
  web: "שאלה שהמאגר לא עונה עליה לבד: כאן נבדק מתי הסוכן פונה לאינטרנט, ומה קובע כשיש סתירה.",
  action: "בקשה לפעולה: הסוכן צריך לאסוף פרטים, לבקש אישור, ורק אז לבצע.",
  multi: "בקשה מורכבת: צריך כמה כלים, בסדר הנכון.",
  boundary: "מקרה גבול: כאן נבדק מה הסוכן לא עושה.",
};
const TOOL_LABEL: Record<string, string> = {
  search_knowledge_base: "חיפוש במאגר הידע",
  web_search: "חיפוש באינטרנט",
  check_availability: "בדיקת שעות פנויות",
  book_appointment: "קביעת תור",
  send_email: "שליחת מייל",
  log_request: "רישום פנייה לצוות",
};
const ACTIONS = new Set(["book_appointment", "send_email", "log_request"]);

function toolRow(label: string, tools: string[], className: string): HTMLElement {
  const row = el("p", "answer__tools", label);
  for (const tool of tools) row.append(el("span", `chip ${className}`, TOOL_LABEL[tool] ?? tool));
  return row;
}

function renderAnswer(preset: Preset | null) {
  const box = $("#answer");
  box.replaceChildren();
  if (!preset) {
    box.append(el("p", "", "בשאלה חופשית העמוד מריץ רק את חיפוש מילות המפתח במאגר. הסוכן עצמו צריך מפתח API, ולכן הוא לא פועל כאן."));
    return;
  }
  box.append(el("p", "answer__kind", KIND[preset.type]));
  for (const followUp of preset.followUps) box.append(el("p", "answer__label", `ובהמשך השיחה הלקוח כותב: "${followUp}"`));
  box.append(el("p", "answer__label", "מה הסוכן אמור לעשות:"));
  box.append(el("p", "answer__text", preset.behavior));
  if (preset.tools.length) box.append(toolRow("כלים שחייבים לפעול: ", preset.tools, "chip--yes"));
  if (preset.noTools.length) box.append(toolRow("כלים שאסור שיפעלו: ", preset.noTools, "chip--no"));
  if (preset.tools.some((tool) => ACTIONS.has(tool))) {
    box.append(el("p", "answer__label", preset.approve ? "בתרחיש הזה הלקוח מאשר את הפעולה." : "בתרחיש הזה הלקוח מסרב לאשר, ולכן שום דבר לא אמור להתבצע."));
  }
}

// ---------- wiring ----------

function run(question: string, preset: Preset | null) {
  const expected = preset?.expected ?? [];
  $("#asked").textContent = question;
  renderWords(question);
  renderList("#hits-keyword", keywordSearch(question), expected, "");
  renderList("#hits-meaning", preset?.dense ?? null, expected, "זמין רק לתרחישים המוכנים: חיפוש לפי משמעות צריך מודל שלא רץ בדפדפן.");
  renderList("#hits-final", preset?.hybrid ?? keywordSearch(question), expected, "");
  $("#final-note").textContent = preset
    ? "הרשימה המאוחדת, כפי שהיא מגיעה לסוכן. המאגר תמיד מחזיר משהו, גם כשאין בו תשובה: הסוכן הוא שמחליט אם הקטעים עונים על השאלה."
    : "בשאלה חופשית מוצגות כאן תוצאות חיפוש מילות המפתח בלבד.";
  renderAnswer(preset);
  document.querySelectorAll<HTMLButtonElement>(".q").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.id === preset?.id)));
}

const TYPE_LABEL: Record<ScenarioType, string> = { kb: "מאגר", web: "אינטרנט", action: "פעולה", multi: "כמה כלים", boundary: "גבול" };

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
