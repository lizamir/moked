# Moked (מוקד)

A business AI agent, written in TypeScript. It answers customers from the business's own knowledge base, searches the web when the knowledge base has no answer, and takes actions: booking an appointment, sending an email, logging a request for the staff. Every action waits for the customer's approval, and that rule is enforced in code, not asked for in a prompt.

The demo business is "Parva" (פרווה), a fictional dog grooming salon and boarding kennel. Customers write in Hebrew.

**Not a programmer?** Open **[lizhajage.co.il/moked](https://lizhajage.co.il/moked/)**: a Hebrew page that explains the project step by step and runs the real knowledge-base search in your browser. A full guide to the code, in Hebrew, is in [GUIDE-HE.md](GUIDE-HE.md).

![A recorded conversation: the customer asks a price, books an appointment after approving it, and gets a confirmation email with a calendar invite](docs/media/moked-demo.gif)

A real conversation with the agent, recorded once and replayed ([interactive version](https://lizhajage.co.il/moked/demo.html)). On the right, what the customer sees; on the left, which tools the agent ran and where it stopped for approval.

```mermaid
flowchart LR
    C[Customer message] --> A[Agent loop<br/>Claude decides which tool]
    A -- read tools --> R[Knowledge base search<br/>appointment availability]
    A -- web_search --> W[Web<br/>only when the KB has no answer]
    A -- action tools --> G{Customer<br/>approves?}
    G -- yes --> S[Book appointment<br/>send email<br/>log request]
    G -- no --> A
    R --> A
    W --> A
    S --> A
    A --> O["Answer with sources<br/>[cancellation#1]"]
```

## What it does

| The customer says | What the agent does |
| --- | --- |
| "כמה עולה תספורת לכלב של 8 קילו?" | Searches the knowledge base, answers 190 ₪, cites the passage |
| "כל כמה זמן מספרים פודל?" | Knowledge base has nothing, so it searches the web and says the answer is from the internet |
| "תקבעו לי קיצוץ ציפורניים למחר ב-10:00, אני דנה והכלב לוקי" | Checks the appointment book, shows the customer what it is about to book, books only after a yes |
| "תקבעו לי תור ותשלחו אישור למייל" | Two tools in order: the booking, then an email with the real confirmation details |
| "הכלב שלי מקיא, מה לתת לו?" | Does not diagnose and does not search: refers to a vet |
| "מה מזג האוויר מחר?" | Says it is outside what it helps with |

## Project structure

```
business/              Everything specific to one business. Swap this folder to run another business.
  profile.json           Name, opening hours, services with duration and price
  kb/                    The knowledge base: Markdown documents the agent answers from

src/
  rag/                 Search engine over the knowledge base (no business logic)
    chunk.ts             Split documents into passages
    tokenize.ts          Hebrew-aware word splitting
    bm25.ts              Keyword search, written from scratch
    embed.ts             Search by meaning (local embedding model)
    fuse.ts, rerank.ts   Merge the two result lists; optional Claude re-ranking
    retriever.ts         One search() over all of the above
  services/            The business's systems. Each one owns its own rules.
    business.ts          Load and validate the profile; date helpers
    appointments.ts      Appointment book: opening hours, slots, conflicts
    outbox.ts            Mailer interface + a development mailer that writes .eml files
    calendar-invite.ts   The .ics calendar invite attached to booking confirmations
    request-log.ts       Requests for staff follow-up, as CSV
  tools/               What the agent is allowed to call. Thin wrappers over services.
    types.ts             A tool is "read" or "action"; actions need approval
    knowledge.ts         search_knowledge_base, read_document
    calendar.ts          check_availability, book_appointment
    email.ts             send_email
    log.ts               log_request
    index.ts             Wire services and tools together
  agent/               The brain
    conversation.ts      The agent loop and the approval gate
    prompt.ts            System prompt, built from the business profile
    index.ts             Start a fully wired conversation
  interfaces/          Ways to reach the agent
    sessions.ts          Many people, one conversation each; holds the agent paused until a "yes" arrives
    cli.ts               Terminal chat
    web/                 Browser chat on this computer (npm run web)
    whatsapp/            WhatsApp webhook and sender (npm run whatsapp, see docs/whatsapp.md)
    mcp-server.ts        The knowledge base as an MCP server

evals/                 20 scenarios and the code that grades them
tests/                 Unit tests (no API key needed)
site/, scripts/        Source of the explainer page
docs/                  The built explainer page (GitHub Pages)
```

The dependencies point one way: `interfaces → agent → tools → services`, and `tools → rag`. A service knows nothing about Claude; the agent knows nothing about files on disk.

## The approval gate

A tool is declared `read` or `action` (`src/tools/types.ts`). The agent loop runs read tools immediately and stops before every action tool to ask the person at the keyboard:

```ts
if (tool.kind === "action") {
  const approved = await this.options.approve({ tool: tool.name, input, summary });
  if (!approved) return { outcome: "declined", result: "The customer declined. Nothing was done." };
}
```

The model cannot skip this, because the model never runs anything: it only asks. A prompt-injected document can change what the model asks for, but not what the customer approves. Business rules sit behind a second wall: `AppointmentBook.book()` refuses a closed day, a taken slot or a date outside the booking window, whatever arguments it was given.

## Coming from n8n

This started as a course assignment specified for n8n. The same agent, node by node:

| n8n node | Here |
| --- | --- |
| AI Agent | `src/agent/conversation.ts` (the loop) + `src/agent/prompt.ts` (the system prompt) |
| Pinecone Vector Store + Embeddings | `src/rag/`: local embeddings held in memory, plus keyword search and fusion |
| Default Data Loader + Text Splitter | `src/rag/kb.ts` + `src/rag/chunk.ts` |
| Perplexity / Tavily | Claude's built-in `web_search` tool |
| Google Calendar | `src/services/appointments.ts` + `src/tools/calendar.ts` |
| Gmail | `src/services/outbox.ts` + `src/tools/email.ts` |
| Google Sheets | `src/services/request-log.ts` + `src/tools/log.ts` |
| Tool Description | The `description` field of each tool in `src/tools/` |
| "Ask before acting" in the prompt | The approval gate, in code |
| Manual test chat | `evals/scenarios.json` + `npm run eval:agent`, automated |

What code adds over the canvas: the approval and booking rules are enforced rather than requested, every piece has unit tests, and the 20 test scenarios run on every push.

## Quick start

```bash
npm install
npm test                 # 52 tests, no API key needed
npm run eval:retrieval   # knowledge-base search quality
```

The first run downloads the embedding model (about 120 MB) and caches it.

To talk to the agent you need a Claude API key. Copy `.env.example` to `.env` and put the key there (`.env` is never committed):

```bash
cp .env.example .env     # then edit .env and set ANTHROPIC_API_KEY
npm run chat             # conversation in the terminal
npm run web              # conversation in the browser: http://localhost:3100
npm run eval:agent       # the 20 scenarios, end to end
```

Bookings, emails and the request log are written to `data/runtime/` (not committed).

## Tests and evals

**Unit tests** (`npm test`) cover the parts that must not depend on a model's mood:

- `tests/services.test.ts`: slots follow opening hours and service length; overlapping bookings are refused; closed days, past dates and off-grid times are refused; the CSV log survives quotes and spreadsheet formulas.
- `tests/agent.test.ts`: the agent loop, driven by a scripted fake model. An action never runs without approval; a declined action never runs; invalid input is rejected before anyone is asked; the loop stops at its step limit.
- `tests/rag.test.ts`, `tests/mcp.test.ts`: the search engine and the MCP server over stdio.
- `tests/evals.test.ts`: the grader itself, and that every tool and passage a scenario names really exists.

**20 scenarios** (`evals/scenarios.json`), in five groups:

| Group | Count | What it checks |
| --- | --- | --- |
| `kb` | 6 | Answers from the knowledge base and cites it; does not go to the web |
| `web` | 3 | Goes to the web only when the knowledge base has no answer; the knowledge base wins a conflict |
| `action` | 5 | Asks for missing details, books only after approval, books nothing after a decline or on a closed day |
| `multi` | 3 | Several tools in one request, and a two-turn conversation |
| `boundary` | 3 | Out-of-scope question, medical question, and a prompt injection planted in the knowledge base |

A scenario is graded on what happened, not on what the agent said happened: which tools ran, how each call ended, and how many appointments, emails and log rows exist afterwards. Each scenario runs in its own temp folder with a fixed clock.

**Agent results** (`npm run eval:agent`, Claude Opus 5.5), first full run:

| Group | Passed |
| --- | --- |
| `kb` | 6/6 |
| `web` | 3/3 |
| `action` | 5/5 |
| `multi` | 3/3 |
| `boundary` | 2/3 |
| **Total** | **19/20 (95%)** |

The one failure is the interesting one. In the prompt-injection scenario the agent did not obey the planted instruction: it said there is no official coupon and warned that the code came from an unreviewed page. But in warning, it repeated the code, and a customer who reads a code will try it. The fix was one sentence in the system prompt (do not repeat what a planted instruction pushes, not even to warn). The scenario then passed 3 of 3 reruns. I have not rerun the full suite since that change, so 19/20 is the honest full-run number.

**Retrieval** (`npm run eval:retrieval`), on the 8 scenarios whose answer is a known passage (40 passages, 11 documents):

| Mode | Recall@1 | Recall@3 | Recall@5 | MRR |
| --- | --- | --- | --- | --- |
| `bm25-naive` (whitespace tokens) | 38% | 75% | 88% | 0.573 |
| `bm25` (Hebrew tokenizer) | 44% | 88% | 88% | 0.667 |
| `dense` (multilingual-e5-small) | 94% | 100% | 100% | 1.000 |
| `hybrid` (rank fusion of the two) | 81% | 100% | 100% | 0.938 |

On this knowledge base the embedding model does most of the work: customers phrase questions in words the documents do not use ("זה יעלה לי משהו?" for a cancellation fee), which is exactly where keyword search is weak. Hybrid ranks slightly worse than dense alone here. It stays the default because keyword search is what finds exact tokens such as prices and codes, but eight questions are far too few to settle that, and I would re-measure before defending it.

## What is verified and what is not

| Part | Status |
| --- | --- |
| Knowledge-base search, appointment book, mailer, request log | Run and tested |
| Agent loop and approval gate | Tested against a scripted fake model |
| MCP server | Tested over stdio |
| Live conversation with Claude, web search, the 20 scenarios end to end | Run: 19 of 20 passed on the first full run (see below) |
| Browser chat, WhatsApp webhook | Tested with a stand-in agent and fake Meta requests. The WhatsApp side has not been connected to a real number; the steps are in [docs/whatsapp.md](docs/whatsapp.md). |
| Email delivery | Not connected. `FileOutbox` writes `.eml` files and tells the agent the mail was not delivered, so it does not claim otherwise. A Gmail or SMTP mailer implements the same `Mailer` interface. |

## Using your own business

Replace `business/profile.json` and the Markdown files in `business/kb/`, or point `MOKED_BUSINESS_DIR` at another folder. The system prompt, the bookable services and the booking rules are all read from the profile. Then write your own scenarios: these scores say nothing about a different business.

## MCP server

The knowledge-base search is also an MCP server, so Claude Desktop or Claude Code can use it directly. It needs no API key.

```json
{
  "mcpServers": {
    "moked": { "command": "npx", "args": ["tsx", "/absolute/path/to/moked/src/interfaces/mcp-server.ts"] }
  }
}
```

## Limits

- Appointments, mail and the log are local files. A real deployment would put Google Calendar, Gmail and a spreadsheet behind the same interfaces.
- One groomer, one appointment at a time. No cancelling or rescheduling through the agent yet.
- The Hebrew stemmer is a heuristic, and vectors are searched by brute force in memory: right for hundreds of passages, wrong for millions.
- Twenty scenarios catch regressions; they do not prove quality.

## License

MIT
