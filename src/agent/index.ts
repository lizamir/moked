import Anthropic from "@anthropic-ai/sdk";
import { createServices, createTools, type Services } from "../tools/index.ts";
import { Conversation, type Approver, type ModelClient } from "./conversation.ts";
import { buildSystemPrompt } from "./prompt.ts";

/** Start a conversation with the fully wired agent. Everything is injectable so evals can use a sandbox. */
export async function startConversation({ approve, services, model }: { approve: Approver; services?: Services; model?: ModelClient }): Promise<Conversation> {
  const s = services ?? (await createServices());
  return new Conversation({
    model: model ?? new Anthropic().messages,
    tools: createTools(s),
    system: buildSystemPrompt(s.profile, s.clock()),
    approve,
    webSearch: true,
    onStep: s.audit ? (step) => s.audit!.record(step) : undefined,
  });
}
