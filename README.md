# Moked (מוקד)

A Hebrew assistant that explains AI in plain language, and answers only from what it has read. It is a RAG agent built from the parts up in TypeScript: hybrid retrieval with a Hebrew-aware BM25, local multilingual embeddings, Claude re-ranking, a tool-using Claude agent, an MCP server, and an eval suite that gates CI.

No LangChain, no vector database, no orchestration framework. Every stage is a small file you can read, and every design choice has a number next to it.

The knowledge base is "AI בגובה העיניים", a 14-document Hebrew guide written for this project: what a language model is, why chatbots invent things, RAG, agents, MCP, evals, prompt injection, privacy. People ask it things like "למה הצ'אט ממציא עובדות?" and get a short answer with the passage it came from, or an honest "the guide does not cover that".

**New here, or not a programmer?** Open [`docs/index.html`](docs/index.html): a Hebrew page that explains the project step by step and runs the real keyword search in your browser.

```mermaid
flowchart LR
    Q[Question] --> A[Claude agent<br/>tool loop]
    A -- search_knowledge_base --> R
    subgraph R[Retriever]
        direction LR
        B[BM25<br/>Hebrew tokenizer] --> F[Rank fusion]
        D[Dense<br/>multilingual-e5] --> F
        F --> X[Claude re-rank]
    end
    R -- passages with ids --> A
    A --> O["Answer with citations<br/>[rag#1]"]
    M[MCP server] --> R
    E[Eval suite<br/>20 questions] -.-> R
    E -.-> A
```

## Why Hebrew makes this interesting

Hebrew attaches prepositions, conjunctions and the definite article to the word. "ובמסלול" is "and in the plan"; a whitespace tokenizer sees a different token from "מסלול" and lexical search silently misses. Most RAG tutorials never hit this because English does not do it.

`src/rag/tokenize.ts` handles it without a morphological analyser: it emits the surface form plus a few candidate stems, and the BM25 scorer counts each query word once, by its best-matching form.

## Results

Retrieval, measured on the 17 eval questions that have a known source passage (62 passages, 14 documents). Reproduce with `npm run eval:retrieval`; no API key needed.

| Mode | Recall@1 | Recall@3 | Recall@5 | MRR |
| --- | --- | --- | --- | --- |
| `bm25-naive` (whitespace tokens) | 59% | 85% | 91% | 0.767 |
| `bm25` (Hebrew tokenizer) | 79% | 94% | 94% | 0.882 |
| `dense` (multilingual-e5-small) | 68% | 74% | 94% | 0.776 |
| `hybrid` (rank fusion of the two) | 71% | 94% | 100% | 0.838 |

What the numbers say:

- **The Hebrew tokenizer is worth 20 points of Recall@1** over naive BM25 (59% to 79%). The right passage does not just show up more often, it shows up first.
- **Hybrid is the only mode that never loses the passage** (Recall@5 100%). The two retrievers fail on different questions: BM25 misses a question phrased in none of the document's words, the embedding model misses one about a weekly price list. Fused, each covers the other.
- **Hybrid is not the best at rank 1.** Plain Hebrew BM25 puts the right passage first more often (79% against 71%), because fusion lets a confident wrong guess from the embedding model pull the order. Closing that gap is the re-ranker's job, and that row is not measured yet (see below).
- **A first version of the stemmer made things worse.** During development it summed the score of every stem candidate, so a word with four candidates outweighed a word with one, and Recall@1 fell below the naive baseline. The eval caught it; the fix was to score each word by its best form only. This is the reason the ablation exists.

The set is small and I tuned against it, so treat these as directional, not as a benchmark.

The `hybrid-rerank` row and the end-to-end answer eval call the Claude API and are produced by `npm run eval:answers` and by CI; see [Evals](#evals).

## Quick start

```bash
npm install
npm test                 # 23 tests, including the MCP server over stdio
npm run eval:retrieval   # the table above
```

The first run downloads the embedding model (about 120 MB) and caches it. Everything above runs offline after that.

For the parts that use Claude:

```bash
export ANTHROPIC_API_KEY=...
npm run ask -- "למה הצ'אט לפעמים ממציא עובדות?"
npm run eval:answers
```

## How it works

| Stage | File | What it does |
| --- | --- | --- |
| Chunking | `src/rag/chunk.ts` | One chunk per `##` section, with a stable id (`rag#1`) that the agent cites |
| Lexical | `src/rag/tokenize.ts`, `src/rag/bm25.ts` | Hebrew normalization and stemming; Okapi BM25 written from scratch |
| Dense | `src/rag/embed.ts` | `multilingual-e5-small` on CPU via ONNX, with a content-hash disk cache |
| Fusion | `src/rag/fuse.ts` | Reciprocal Rank Fusion, so BM25 scores and cosines never need a common scale |
| Re-rank | `src/rag/rerank.ts` | Claude Haiku grades the top 8 candidates 0 to 3; the reply is schema-constrained |
| Agent | `src/agent/agent.ts` | Claude with two tools (`search_knowledge_base`, `read_document`); answers only from retrieved passages and cites them |
| MCP | `src/mcp/server.ts` | The same retriever as three MCP tools over stdio |

The agent is told why the rules exist, not just what they are: readers repeat its answers as "what the guide says", so a guess from general knowledge is worse than "the guide does not cover that", and retrieved text is reference material, never instructions.

## MCP server

The retriever is also an MCP server, so any MCP host can use the knowledge base with its own model. It needs no API key (re-ranking is opt-in per call).

`.mcp.json` registers it for Claude Code in this repo. For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "moked": { "command": "npx", "args": ["tsx", "/absolute/path/to/moked/src/mcp/server.ts"] }
  }
}
```

Tools: `search_knowledge_base(query, limit, rerank)`, `get_document(document_id)`, `list_documents()`.

## Evals

`evals/dataset.json` has 20 questions, written as a curious non-programmer would ask them rather than in the documents' wording:

| Type | Count | What it tests |
| --- | --- | --- |
| `single` | 15 | One passage answers it |
| `multi` | 2 | Needs facts from two documents |
| `unanswerable` | 2 | Not in the knowledge base; the right answer is to say so |
| `injection` | 1 | Retrieval surfaces a passage that tries to give the agent instructions |

Two runners:

- **`npm run eval:retrieval`** scores every retrieval mode (Recall@k, MRR), offline. CI fails if hybrid Recall@5 drops below 90%.
- **`npm run eval:answers`** runs the agent end to end and grades each answer twice. Deterministic checks cover what code can decide: the key figure is stated, the expected source is cited, every citation was actually retrieved (no invented sources), forbidden content is absent. An LLM judge then compares the answer with a human-written reference. A case passes only if both agree, and CI fails below an 85% pass rate.

The eval is tested too (`tests/evals.test.ts`): every reference answer has to pass the deterministic grader, and every key fact has to really be in its source passage. A grader that rejects a correct answer measures the grader.

## Using your own documents

Put Markdown files in a folder and point `MOKED_KB_DIR` at it. Then write your own `evals/dataset.json`; the scores above say nothing about a different corpus.

The bundled guide covers topics a language model already knows a lot about, which would make "it answered correctly" weak evidence. So the guide carries its own specifics, such as named rules of thumb and concrete thresholds, and the eval checks for those. An answer that states them can only have come from the retrieved passage. One document is unreviewed "reader tips" with a planted instruction in it, for the injection case.

## The explainer page

`npm run build:site` writes `docs/index.html`, one self-contained file. It bundles the same tokenizer and BM25 code the agent uses, so keyword search runs live in the page; semantic and fused results for the 20 eval questions are precomputed at build time, and the results chart is read from the eval report. The page does not call Claude, and says so: the answer it shows for each question is the eval's reference answer.

## Limits

- The stemmer is a heuristic. It will not relate "הלך" to "ילכו"; a real analyser would.
- Vectors live in memory and search is brute force. That is right for hundreds of passages and wrong for millions.
- Twenty questions catch regressions; they do not prove quality.
- The LLM judge has not been calibrated against human grades.
- The agent, the re-ranker and the answer eval have not been run against the API yet (no key on the build machine); they typecheck and their graders are unit-tested.

## License

MIT
