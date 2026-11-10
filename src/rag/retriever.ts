import { Bm25Index } from "./bm25.ts";
import { searchableText } from "./chunk.ts";
import { dot } from "./embed.ts";
import { reciprocalRankFusion } from "./fuse.ts";
import { tokenizeHebrew, tokenizeHebrewGrouped, tokenizeNaive } from "./tokenize.ts";
import type { Chunk, Embedder, Reranker, RetrievalMode, ScoredChunk } from "./types.ts";

const FIRST_STAGE_K = 20;
const RERANK_K = 8;

export interface RetrieverOptions {
  embedder?: Embedder;
  reranker?: Reranker;
}

export class Retriever {
  private readonly bm25: Bm25Index;
  private readonly bm25Naive: Bm25Index;
  private vectors: Promise<number[][]> | undefined;

  constructor(
    readonly chunks: Chunk[],
    private readonly options: RetrieverOptions = {},
  ) {
    const texts = chunks.map(searchableText);
    this.bm25 = new Bm25Index(texts.map(tokenizeHebrew));
    this.bm25Naive = new Bm25Index(texts.map(tokenizeNaive));
  }

  /** The best mode the configured components allow. */
  get defaultMode(): RetrievalMode {
    if (!this.options.embedder) return "bm25";
    return this.options.reranker ? "hybrid-rerank" : "hybrid";
  }

  async search(query: string, { mode = this.defaultMode, k = 5 }: { mode?: RetrievalMode; k?: number } = {}): Promise<ScoredChunk[]> {
    switch (mode) {
      case "bm25-naive":
        return this.lexical(this.bm25Naive, tokenizeNaive(query).map((t) => [t])).slice(0, k);
      case "bm25":
        return this.lexical(this.bm25, tokenizeHebrewGrouped(query)).slice(0, k);
      case "dense":
        return (await this.dense(query)).slice(0, k);
      case "hybrid":
        return (await this.hybrid(query)).slice(0, k);
      case "hybrid-rerank": {
        const reranker = this.options.reranker;
        if (!reranker) throw new Error("hybrid-rerank mode needs a reranker");
        const candidates = (await this.hybrid(query)).slice(0, RERANK_K);
        const ordered = await reranker.rerank(query, candidates.map((c) => c.chunk));
        return ordered.slice(0, k).map((chunk, rank) => ({ chunk, score: 1 / (rank + 1) }));
      }
    }
  }

  private lexical(index: Bm25Index, words: string[][]): ScoredChunk[] {
    return index.search(words, FIRST_STAGE_K).map((hit) => ({ chunk: this.chunks[hit.index]!, score: hit.score }));
  }

  private async dense(query: string): Promise<ScoredChunk[]> {
    const embedder = this.options.embedder;
    if (!embedder) throw new Error("dense retrieval needs an embedder");
    this.vectors ??= embedder.embed(this.chunks.map(searchableText), "passage");
    const [vectors, [queryVector]] = await Promise.all([this.vectors, embedder.embed([query], "query")]);
    return vectors
      .map((vector, i) => ({ chunk: this.chunks[i]!, score: dot(vector, queryVector!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, FIRST_STAGE_K);
  }

  private async hybrid(query: string): Promise<ScoredChunk[]> {
    const lexical = this.lexical(this.bm25, tokenizeHebrewGrouped(query)).map((s) => s.chunk);
    const dense = (await this.dense(query)).map((s) => s.chunk);
    return reciprocalRankFusion([lexical, dense]).map(({ item, score }) => ({ chunk: item, score }));
  }
}
