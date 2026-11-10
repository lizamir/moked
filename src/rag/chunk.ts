import type { Chunk, Doc } from "./types.ts";

const MAX_CHARS = 1200;

/**
 * Split on `##` headings so a chunk is one self-contained topic, then on
 * paragraphs if a section runs long. Text before the first heading becomes an
 * intro chunk.
 */
export function chunkDoc(doc: Doc): Chunk[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: doc.title, lines: [] }];
  for (const line of doc.text.split("\n")) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) sections.push({ heading: line.slice(3).trim(), lines: [] });
    else sections.at(-1)!.lines.push(line);
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const text of splitLong(section.lines.join("\n").trim())) {
      chunks.push({
        id: `${doc.id}#${chunks.length + 1}`,
        docId: doc.id,
        docTitle: doc.title,
        heading: section.heading,
        text,
      });
    }
  }
  return chunks;
}

function splitLong(text: string): string[] {
  if (!text) return [];
  if (text.length <= MAX_CHARS) return [text];
  const parts: string[] = [];
  let current = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (current && current.length + para.length > MAX_CHARS) {
      parts.push(current.trim());
      current = "";
    }
    current += para + "\n\n";
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** What gets indexed: the title and heading carry a lot of the topical signal. */
export function searchableText(chunk: Chunk): string {
  return `${chunk.docTitle}\n${chunk.heading}\n${chunk.text}`;
}
