import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Embedder } from "./types.ts";

/**
 * Local multilingual embeddings (no API key, runs on CPU via ONNX).
 * e5 models expect a "query: " / "passage: " prefix on every input.
 */
export class LocalE5Embedder implements Embedder {
  readonly name: string;
  private extractor: Promise<(texts: string[], options: object) => Promise<{ tolist(): number[][] }>> | undefined;

  constructor(private readonly model = "Xenova/multilingual-e5-small") {
    this.name = model;
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    this.extractor ??= import("@huggingface/transformers").then(
      ({ pipeline }) => pipeline("feature-extraction", this.model, { dtype: "q8" }) as never,
    );
    const extractor = await this.extractor;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => `${kind}: ${t}`);
      out.push(...(await extractor(batch, { pooling: "mean", normalize: true })).tolist());
    }
    return out;
  }
}

/** Disk cache keyed by content hash, so re-indexing only embeds what changed. */
export class CachedEmbedder implements Embedder {
  readonly name: string;
  private cache: Map<string, number[]> | undefined;
  private readonly file: string;

  constructor(
    private readonly inner: Embedder,
    cacheDir = ".cache",
  ) {
    this.name = inner.name;
    this.file = path.join(cacheDir, `embeddings-${inner.name.replace(/[^\w.-]+/g, "_")}.json`);
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    this.cache ??= await this.load();
    const keys = texts.map((t) => createHash("sha1").update(`${kind}:${t}`).digest("hex"));
    const missing = texts.map((_, i) => i).filter((i) => !this.cache!.has(keys[i]!));
    if (missing.length > 0) {
      const vectors = await this.inner.embed(missing.map((i) => texts[i]!), kind);
      missing.forEach((i, j) => this.cache!.set(keys[i]!, vectors[j]!.map((x) => Math.round(x * 1e5) / 1e5)));
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify(Object.fromEntries(this.cache)));
    }
    return keys.map((key) => this.cache!.get(key)!);
  }

  private async load(): Promise<Map<string, number[]>> {
    try {
      return new Map(Object.entries(JSON.parse(await readFile(this.file, "utf8")) as Record<string, number[]>));
    } catch {
      return new Map();
    }
  }
}

/** Vectors are L2-normalized, so the dot product is the cosine similarity. */
export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
