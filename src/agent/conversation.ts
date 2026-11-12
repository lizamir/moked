import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AgentTool } from "../tools/types.ts";

export const AGENT_MODEL = process.env.MOKED_AGENT_MODEL ?? "claude-opus-5-5";

/** The one method of the Claude client the loop needs. Tests pass a scripted fake. */
export interface ModelClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface ApprovalRequest {
  tool: string;
  input: unknown;
  /** One line in the customer's language: exactly what will happen. */
  summary: string;
}
/** Asks the person in front of the screen. Resolves true only on an explicit yes. */
export type Approver = (request: ApprovalRequest) => Promise<boolean>;

/** One thing the agent did during a turn. The eval suite grades these, not just the final text. */
export interface Step {
  tool: string;
  kind: "read" | "action" | "web";
  input: unknown;
  /** ok: ran. declined: the customer said no. invalid: the model's input failed the schema. error: the tool refused or failed. */
  outcome: "ok" | "declined" | "invalid" | "error";
  result: string;
}

export interface Turn {
  answer: string;
  steps: Step[];
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ConversationOptions {
  model: ModelClient;
  tools: AgentTool[];
  system: string;
  approve: Approver;
  modelName?: string;
  /** Let Claude search the web (a server-side tool: Anthropic runs the search, not this process). */
  webSearch?: boolean;
  /** Called once for every tool call, whatever its outcome. The audit log hangs here. */
  onStep?: (step: Step) => void | Promise<void>;
  /** Upper bound on model calls per customer message, so a confused agent stops instead of looping. */
  maxSteps?: number;
}

/**
 * The answer as a customer should see it: without the passage ids. The ids
 * stay in `Turn.answer`, where the evals check that the agent cited its source.
 */
export function withoutCitations(answer: string): string {
  return answer
    .replace(/[ \t]*\[[a-z0-9-]+#\d+\]/g, "")
    .replace(/[ \t]+([.,!?:])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function extractCitations(answer: string): string[] {
  return [...new Set([...answer.matchAll(/\[([a-z0-9-]+#\d+)\]/g)].map((m) => m[1]!))];
}

/**
 * A multi-turn conversation with the agent.
 *
 * `send` runs the agent loop for one customer message: ask the model, run the
 * tools it requested, give it the results, repeat until it answers in text.
 * Action tools pass through `approve` first. That gate lives here, in code,
 * so no wording in a prompt, a document or a web page can talk the agent
 * past it.
 */
export class Conversation {
  private readonly messages: Anthropic.MessageParam[] = [];
  private readonly toolsByName: Map<string, AgentTool>;
  private readonly toolParams: Anthropic.ToolUnion[];

  constructor(private readonly options: ConversationOptions) {
    this.toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.toolParams = options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: z.toJSONSchema(tool.schema) as Anthropic.Tool.InputSchema,
    }));
    if (options.webSearch) this.toolParams.push({ type: "web_search_20260209", name: "web_search", max_uses: 3 });
  }

  async send(text: string): Promise<Turn> {
    this.messages.push({ role: "user", content: text });
    const steps: Step[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let last: Anthropic.Message | undefined;

    for (let i = 0; i < (this.options.maxSteps ?? 10); i++) {
      last = await this.options.model.create({
        model: this.options.modelName ?? AGENT_MODEL,
        max_tokens: 16000,
        system: this.options.system,
        tools: this.toolParams,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        messages: this.messages,
      });
      usage.inputTokens += last.usage.input_tokens;
      usage.outputTokens += last.usage.output_tokens;
      // The whole content goes back unchanged: thinking and server-tool blocks must be replayed exactly.
      this.messages.push({ role: "assistant", content: last.content });

      for (const block of last.content) {
        if (block.type === "server_tool_use") {
          const step: Step = { tool: block.name, kind: "web", input: block.input, outcome: "ok", result: "" };
          steps.push(step);
          await this.options.onStep?.(step);
        }
      }

      // A long web search can pause mid-turn; sending the conversation back lets the server continue it.
      if (last.stop_reason === "pause_turn") continue;

      const calls = last.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      if (calls.length === 0) break;
      // A tool input cut off by the token limit can still parse as valid JSON. Never run it.
      if (last.stop_reason === "max_tokens") throw new Error("The model's tool call was cut off by max_tokens");

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const step = await this.runTool(call);
        steps.push(step);
        await this.options.onStep?.(step);
        results.push({ type: "tool_result", tool_use_id: call.id, content: step.result, is_error: step.outcome === "invalid" || step.outcome === "error" });
      }
      this.messages.push({ role: "user", content: results });
    }

    if (!last) throw new Error("The model returned no message");
    const answer = last.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return { answer, steps, stopReason: last.stop_reason, usage };
  }

  private async runTool(call: Anthropic.ToolUseBlock): Promise<Step> {
    const tool = this.toolsByName.get(call.name);
    if (!tool) return { tool: call.name, kind: "read", input: call.input, outcome: "error", result: `Unknown tool '${call.name}'.` };

    const base = { tool: tool.name, kind: tool.kind, input: call.input };
    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) return { ...base, outcome: "invalid", result: `Invalid input: ${z.prettifyError(parsed.error)}` };

    if (tool.kind === "action") {
      const summary = tool.summarize?.(parsed.data) ?? tool.name;
      const approved = await this.options.approve({ tool: tool.name, input: parsed.data, summary });
      if (!approved) return { ...base, outcome: "declined", result: "The customer declined. Nothing was done. Do not retry; ask what they would like instead." };
    }

    try {
      return { ...base, outcome: "ok", result: await tool.run(parsed.data) };
    } catch (error) {
      // The tool's own refusal ("that time is taken") is information the model needs in order to recover.
      return { ...base, outcome: "error", result: error instanceof Error ? error.message : String(error) };
    }
  }
}
