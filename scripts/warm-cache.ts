/**
 * Downloads the embedding model and computes the knowledge base's vectors,
 * so the first customer question does not wait for either. The Docker build
 * runs this once and the result ships inside the image.
 */
import { createRetriever, loadKnowledgeBase } from "../src/rag/kb.ts";

const kb = await loadKnowledgeBase();
const hits = await createRetriever(kb, { rerank: false }).search("שעות פתיחה", { k: 1, mode: "hybrid" });
console.log(`Search index ready: ${kb.docs.size} documents, top hit ${hits[0]?.chunk.id ?? "none"}`);
