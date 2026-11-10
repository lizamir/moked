/**
 * Terminal chat with the agent.
 *   npm run chat                 interactive conversation
 *   npm run ask -- "שאלה"        one question, then exit
 */
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import type { Approver, Turn } from "../agent/conversation.ts";
import { startConversation } from "../agent/index.ts";
import { hasAnthropicCredentials } from "../rag/kb.ts";

if (!hasAnthropicCredentials()) {
  console.error("The agent calls the Claude API. Set ANTHROPIC_API_KEY (see .env.example).");
  process.exit(2);
}

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const question = process.argv.slice(2).join(" ").trim();

/** The approval gate, as the customer sees it: nothing changes unless they type "כן" or "y". */
const approve: Approver = async ({ summary }) => {
  const reply = (await terminal.question(`\n⚠ הסוכן מבקש אישור: ${summary}\n  לאשר? (כן/לא) `)).trim().toLowerCase();
  return ["כן", "y", "yes"].includes(reply);
};

function print(turn: Turn) {
  console.log(`\n${turn.answer}\n`);
  for (const step of turn.steps) console.error(`  · ${step.tool} [${step.outcome}] ${JSON.stringify(step.input)}`);
  console.error(`  · ${turn.usage.inputTokens} in / ${turn.usage.outputTokens} out tokens\n`);
}

try {
  const conversation = await startConversation({ approve });
  if (question) {
    print(await conversation.send(question));
  } else {
    console.log('שיחה עם העוזר של פרווה. "יציאה" לסיום.\n');
    for (;;) {
      const text = (await terminal.question("את/ה: ")).trim();
      if (!text) continue;
      if (text === "יציאה" || text === "exit") break;
      print(await conversation.send(text));
    }
  }
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) console.error("Claude credentials are missing or invalid. Set ANTHROPIC_API_KEY (see .env.example).");
  else if (error instanceof Anthropic.RateLimitError) console.error("Rate limited by the Claude API. Try again in a moment.");
  else if (error instanceof Anthropic.APIError) console.error(`Claude API error ${error.status}: ${error.message}`);
  else throw error;
  process.exitCode = 1;
} finally {
  terminal.close();
}
