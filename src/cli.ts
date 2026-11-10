import Anthropic from "@anthropic-ai/sdk";
import { ask } from "./agent/agent.ts";
import { createRetriever, hasAnthropicCredentials, loadKnowledgeBase } from "./rag/kb.ts";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "למה AI ממציא דברים?"');
  process.exit(1);
}
if (!hasAnthropicCredentials()) {
  console.error("The agent calls the Claude API. Set ANTHROPIC_API_KEY (see .env.example).");
  process.exit(2);
}

const kb = await loadKnowledgeBase();
try {
  const result = await ask(question, { kb, retriever: createRetriever(kb) });
  console.log(`\n${result.answer}\n`);
  for (const call of result.toolCalls) {
    console.error(`· ${call.name}(${JSON.stringify(call.input)}) → ${call.chunkIds.join(", ")}`);
  }
  console.error(`· ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`);
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("Claude credentials are missing or invalid. Set ANTHROPIC_API_KEY (see .env.example).");
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error("Rate limited by the Claude API. Try again in a moment.");
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Claude API error ${error.status}: ${error.message}`);
  } else {
    throw error;
  }
  process.exit(1);
}
