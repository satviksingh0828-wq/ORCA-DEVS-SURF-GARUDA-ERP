import { init } from "@heyputer/puter.js/src/init.cjs";
import {
  LLMClient,
  type ChatMessage,
  type CreateChatCompletionOptions,
  type LLMResponse,
} from "@browserbasehq/stagehand";

/** Fixed Puter model. The model choice is intentionally code-owned, not configurable by env. */
export const ORCA_PUTER_MODEL = "gpt-5.4-nano";

function puterAuthToken() {
  const token = process.env.PUTER_AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error("PUTER_AUTH_TOKEN is not configured. ORCA AGENT requires Puter authentication.");
  }
  return token;
}

/**
 * Stagehand remains the browser hand, while this adapter makes Puter the only
 * reasoning model used for act/observe/extract calls.
 */
export class PuterLLMClient extends LLMClient {
  type = "puter" as const;
  modelName = ORCA_PUTER_MODEL;
  hasVision = true;
  clientOptions = {};
  private readonly puter: any;

  constructor() {
    super(ORCA_PUTER_MODEL as never, "ORCA AGENT uses Puter only. Never use another model provider.");
    this.puter = init(puterAuthToken());
  }

  async createChatCompletion<T = LLMResponse>({ options }: CreateChatCompletionOptions): Promise<T> {
    const result = await this.puter.ai.chat(
      options.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : message.content,
      })),
      {
        model: ORCA_PUTER_MODEL,
        normalize: true,
        temperature: options.temperature,
        max_tokens: options.maxOutputTokens,
        tools: options.tools,
        tool_choice: options.tool_choice,
      },
    );

    const message = result?.message ?? result;
    const content = typeof message?.content === "string" ? message.content : "";
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((tool: any) => ({
          id: tool.id ?? `puter-tool-${Date.now()}`,
          type: "function",
          function: {
            name: tool.function?.name ?? tool.name ?? "unknown",
            arguments:
              typeof tool.function?.arguments === "string"
                ? tool.function.arguments
                : JSON.stringify(tool.function?.arguments ?? tool.arguments ?? {}),
          },
        }))
      : [];

    const response = {
      id: result?.id ?? `puter-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: ORCA_PUTER_MODEL,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content, tool_calls: toolCalls },
          finish_reason: toolCalls.length ? "tool_calls" : "stop",
        },
      ],
      usage: {
        prompt_tokens: result?.usage?.prompt_tokens ?? 0,
        completion_tokens: result?.usage?.completion_tokens ?? 0,
        total_tokens: result?.usage?.total_tokens ?? 0,
      },
    } satisfies LLMResponse;

    if ((options as any).response_model) {
      let data: unknown = {};
      try {
        data = JSON.parse(content);
      } catch {
        data = { result: content };
      }
      return { data, usage: response.usage } as T;
    }

    return response as T;
  }
}
