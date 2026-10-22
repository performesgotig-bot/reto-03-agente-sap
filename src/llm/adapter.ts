export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmResponse = {
  message: ChatMessage;
  inputTokens: number;
};

export interface LlmAdapter {
  enviar(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmResponse>;
  readonly provider: string;
  readonly model: string;
}
