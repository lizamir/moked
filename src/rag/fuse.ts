/**
 * Reciprocal Rank Fusion: combine ranked lists using ranks only, so BM25
 * scores and cosine similarities never need to be put on a common scale.
 */
export function reciprocalRankFusion<T>(rankings: T[][], k = 60): { item: T; score: number }[] {
  const scores = new Map<T, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      scores.set(item, (scores.get(item) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores].map(([item, score]) => ({ item, score })).sort((a, b) => b.score - a.score);
}
