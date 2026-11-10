export interface Doc {
  id: string;
  title: string;
  text: string;
}

export interface Chunk {
  /** `${docId}#${n}`: stable, human-readable, and what the agent cites. */
  id: string;
  docId: string;
  docTitle: string;
  heading: string;
  text: string;
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

export interface Embedder {
  readonly name: string;
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
}

export interface Reranker {
  readonly name: string;
  /** Returns the candidates reordered, most relevant first. */
  rerank(query: string, candidates: Chunk[]): Promise<Chunk[]>;
}

export const RETRIEVAL_MODES = [
  "bm25-naive",
  "bm25",
  "dense",
  "hybrid",
  "hybrid-rerank",
] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];
