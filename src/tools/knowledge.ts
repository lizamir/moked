import { z } from "zod";
import { formatChunk, type KnowledgeBase } from "../rag/kb.ts";
import type { Retriever } from "../rag/retriever.ts";
import { defineTool } from "./types.ts";

export function knowledgeTools(kb: KnowledgeBase, retriever: Retriever, businessName: string) {
  return [
    defineTool({
      name: "search_knowledge_base",
      kind: "read",
      description: `Search ${businessName}'s own knowledge base: services, prices, opening hours, booking and cancellation policy, boarding, daycare, required vaccines, payments. This is the official source and always the first place to look for anything about the business. Use a short Hebrew query about one topic; search again with other words, or once per topic, if the first results do not answer. It always returns its closest passages, even when none is relevant, so read them and judge. Each passage has an id to cite.`,
      schema: z.object({ query: z.string().describe("What to look for, e.g. 'ביטול תור דמי ביטול'") }),
      run: async ({ query }) => {
        const hits = await retriever.search(query, { k: 5 });
        return hits.length ? hits.map((h) => formatChunk(h.chunk)).join("\n\n") : "No passages matched.";
      },
    }),
    defineTool({
      name: "read_document",
      kind: "read",
      description: "Read one whole knowledge-base document when a search result is relevant but you need the sections around it. The document id is the part of a passage id before '#'.",
      schema: z.object({ document_id: z.string().describe("e.g. 'cancellation'") }),
      run: async ({ document_id }) => {
        const chunks = kb.chunks.filter((c) => c.docId === document_id);
        if (!chunks.length) throw new Error(`No document '${document_id}'. Available: ${[...kb.docs.keys()].join(", ")}`);
        return chunks.map(formatChunk).join("\n\n");
      },
    }),
  ];
}
