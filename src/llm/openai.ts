import OpenAI from "openai";
import type { ChatMessage, LlmAdapter, LlmResponse, ToolDefinition } from "./adapter.js";

export class OpenAiAdapter implements LlmAdapter {
  readonly provider = "OpenAI";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey, timeout: 30000, maxRetries: 1 });
    this.model = model;
  }

  async enviar(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: "auto",
      temperature: 0.1,
    });
    const choice = response.choices[0];
    if (!choice) throw new Error("El proveedor no devolvió una respuesta.");
    const message = choice.message;
    return {
      message: {
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls?.flatMap((call) =>
          call.type === "function"
            ? [{
                id: call.id,
                type: "function" as const,
                function: { name: call.function.name, arguments: call.function.arguments },
              }]
            : []
        ),
      },
      inputTokens: response.usage?.total_tokens ?? 0,
    };
  }
}
