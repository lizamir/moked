import type { z } from "zod";

/**
 * One capability the agent can use.
 *
 * `kind` is the safety boundary: a "read" tool only looks things up, an
 * "action" tool changes something outside the conversation (a booking, an
 * email, a log entry) and therefore runs only after the customer approves it.
 * The approval is enforced by the agent loop, not requested in the prompt.
 */
export interface AgentTool<Input = unknown> {
  name: string;
  /** Read by the model to decide when to call the tool, so it says when to use it and when not to. */
  description: string;
  schema: z.ZodType<Input>;
  kind: "read" | "action";
  /** One line, in the customer's language, saying exactly what will happen. Shown when asking for approval. */
  summarize?(input: Input): string;
  run(input: Input): Promise<string>;
}

/** Keeps each tool's input type inside its own definition while letting them share one array. */
export const defineTool = <Input>(tool: AgentTool<Input>): AgentTool => tool as AgentTool;
