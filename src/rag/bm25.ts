export interface Bm25Hit {
  index: number;
  score: number;
}

/** Okapi BM25 over pre-tokenized documents. */
export class Bm25Index {
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly lengths: number[];
  private readonly avgLength: number;

  constructor(
    docs: string[][],
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {
    this.lengths = docs.map((d) => d.length);
    this.avgLength = this.lengths.reduce((a, n) => a + n, 0) / Math.max(docs.length, 1);
    docs.forEach((tokens, index) => {
      for (const token of tokens) {
        let posting = this.postings.get(token);
        if (!posting) this.postings.set(token, (posting = new Map()));
        posting.set(index, (posting.get(index) ?? 0) + 1);
      }
    });
  }

  /**
   * Each query word is a group of alternative forms. A document scores the
   * best-matching form of each word, so a word with many stem candidates does
   * not outweigh a word with one.
   */
  search(queryWords: string[][], limit: number): Bm25Hit[] {
    const scores = new Map<number, number>();
    const n = this.lengths.length;
    for (const forms of queryWords) {
      const best = new Map<number, number>();
      for (const token of new Set(forms)) {
        const posting = this.postings.get(token);
        if (!posting) continue;
        const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
        for (const [index, tf] of posting) {
          const norm = 1 - this.b + this.b * (this.lengths[index]! / this.avgLength);
          const gain = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
          if (gain > (best.get(index) ?? 0)) best.set(index, gain);
        }
      }
      for (const [index, gain] of best) scores.set(index, (scores.get(index) ?? 0) + gain);
    }
    return [...scores]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit);
  }
}
