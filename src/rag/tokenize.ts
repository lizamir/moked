/**
 * Hebrew-aware tokenization for lexical search.
 *
 * Hebrew glues prepositions, conjunctions and the definite article onto the
 * word ("ובמסלול" = "and in the plan"), so whitespace tokenization makes the
 * query term "מסלול" miss a document that says "במסלול". A full morphological
 * analyser would be the heavyweight answer; this is the light one: emit the
 * surface form plus a few plausible stems and let BM25's IDF sort out the noise.
 * `evals/retrieval.ts` measures what that buys over the naive tokenizer.
 */

const NIQQUD = /[֑-ׇ]/g;
const FINAL_LETTERS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const HEBREW_WORD = /^[א-ת]+$/;
const PREFIX_LETTERS = new Set([..."והבלמשכ"]);
/** Two-letter prefix stacks that are common enough to be worth a guess ("ובמסלול", "שהלקוח", "כשהתור"). */
const PREFIX_PAIRS = new Set(["וה", "וב", "ול", "ומ", "וש", "וכ", "שה", "שב", "של", "שמ", "כש", "לכ"]);
const SUFFIXES = ["ימ", "ות", "ה", "ת"];
const MIN_STEM = 3;

const STOPWORDS = new Set(
  ["של", "את", "על", "עם", "או", "גם", "כל", "לא", "הוא", "היא", "זה", "זו", "אם", "כי", "יש", "מה", "איך", "כמה", "האם", "מתי", "איפה", "למה", "אני", "לי", "שלי", "אפשר", "צריך", "אחרי", "לפני", "עד", "רק"].map(
    normalize,
  ),
);

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(NIQQUD, "")
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c] ?? c)
    .replace(/["'׳״`]/g, "");
}

/** Words, numbers and compounds such as "e-4012", "appointment.created", "דו-כיווני". */
const RAW_TOKEN = /[\p{L}\p{N}]+(?:[-.:_/][\p{L}\p{N}]+)*/gu;

/** Baseline for the ablation: lowercase + split, nothing language-specific. */
export function tokenizeNaive(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The surface form plus candidate stems. Some candidates are not real words
 * ("לקוח" also yields "קוח"); that is fine, because a junk stem only ever
 * matches the same junk stem of the same word.
 */
export function hebrewVariants(word: string): string[] {
  const variants = new Set<string>([word]);
  if (!HEBREW_WORD.test(word)) return [...variants];

  if (PREFIX_LETTERS.has(word[0]!) && word.length - 1 >= MIN_STEM) variants.add(word.slice(1));
  if (PREFIX_PAIRS.has(word.slice(0, 2)) && word.length - 2 >= MIN_STEM) variants.add(word.slice(2));
  for (const v of [...variants]) {
    const suffix = SUFFIXES.find((s) => v.endsWith(s) && v.length - s.length >= MIN_STEM);
    if (suffix) variants.add(v.slice(0, -suffix.length));
  }
  return [...variants].filter((v) => !STOPWORDS.has(v));
}

/**
 * One group of variants per word. Keeping the grouping lets the scorer count a
 * word once (its best-matching variant) instead of once per variant.
 */
export function tokenizeHebrewGrouped(text: string): string[][] {
  const groups: string[][] = [];
  for (const raw of normalize(text).match(RAW_TOKEN) ?? []) {
    const parts = raw.split(/[-.:_/]/);
    const words = parts.length > 1 ? [parts.join(""), ...parts.filter((p) => p.length > 1)] : parts;
    for (const word of words) {
      if (STOPWORDS.has(word)) continue;
      const variants = hebrewVariants(word);
      if (variants.length > 0) groups.push(variants);
    }
  }
  return groups;
}

/** Flat form, used on the document side where every variant is indexed. */
export function tokenizeHebrew(text: string): string[] {
  return tokenizeHebrewGrouped(text).flat();
}
