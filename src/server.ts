import "dotenv/config";
import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { OpenAiAdapter } from "./llm/openai.js";
import type { ChatMessage, LlmAdapter, ToolDefinition } from "./llm/adapter.js";
import { getOutputDirectory } from "./runtime/storage.js";
import { toolSchemas } from "./tools/oc.js";

type ToolKey = keyof typeof toolSchemas;
type ToolCallView = {
  tool: string;
  arguments: unknown;
  result: unknown;
  summary: string;
};
type PendingConfirmation = {
  caso: string;
  payload: unknown;
};
type Session = {
  messages: ChatMessage[];
  toolCalls: ToolCallView[];
  pendingConfirmation?: PendingConfirmation;
  tokens: number;
  needsConfirmation: boolean;
};

const directory = process.cwd();
const systemPrompt = await readFile(path.join(directory, "agent", "prompt.md"), "utf8").catch(
  () => "Usa solo datos devueltos por herramientas. No inventes información. Respeta bloqueos y confirmaciones humanas."
);
const app = express();
const sessions = new Map<string, Session>();
const maximumIterations = positiveInteger(process.env.MAX_TOOL_ITERATIONS, 25);
const maximumSessionTokens = positiveInteger(process.env.MAX_SESSION_TOKENS, 24000);
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const llm: LlmAdapter | null = process.env.OPENAI_API_KEY
  ? new OpenAiAdapter(process.env.OPENAI_API_KEY, model)
  : null;
const toolDefinitions = createToolDefinitions();

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(directory, "public")));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, provider: llm?.provider ?? "no configurado", model: llm?.model ?? model });
});

app.get("/api/sessions/:id", (request, response) => {
  const session = sessions.get(request.params.id);
  if (!session) {
    response.status(404).json({ ok: false, error: "No existe esa sesión." });
    return;
  }
  response.json({
    messages: session.messages.filter((message) => message.role !== "system"),
    toolCalls: session.toolCalls,
    needsConfirmation: session.needsConfirmation,
  });
});

app.post("/api/chat", async (request, response) => {
  const parsedBody = zChatBody.safeParse(request.body);
  if (!parsedBody.success) {
    response.status(400).json({ ok: false, error: "Envía sessionId y un mensaje de texto." });
    return;
  }
  const { sessionId, message } = parsedBody.data;
  const session = sessions.get(sessionId) ?? createSession();
  sessions.set(sessionId, session);
  const turnToolCalls: ToolCallView[] = [];

  if (session.pendingConfirmation) {
    if (!isNegative(message) && isAffirmative(message)) {
      const pending = session.pendingConfirmation;
      const result = parseResult(
        await toolSchemas.crear.execute(
          { caso: pending.caso, payload: pending.payload as Parameters<typeof toolSchemas.crear.execute>[0]["payload"], confirmado: true },
          { directory, sessionId }
        )
      );
      const view = makeToolView("oc_crear", { caso: pending.caso, confirmado: true }, result);
      turnToolCalls.push(view);
      session.toolCalls.push(view);
      await logToolCall(sessionId, view);
      session.messages.push({ role: "user", content: message });
      session.messages.push({ role: "assistant", content: confirmationReply(result) });
      session.pendingConfirmation = undefined;
      session.needsConfirmation = false;
      response.json({ reply: confirmationReply(result), toolCalls: turnToolCalls, needsConfirmation: false });
      return;
    }
    if (isNegative(message)) {
      session.pendingConfirmation = undefined;
      session.needsConfirmation = false;
      session.messages.push({ role: "user", content: message });
      session.messages.push({ role: "assistant", content: "Entendido. No se creó la orden de compra." });
      response.json({ reply: "Entendido. No se creó la orden de compra.", toolCalls: [], needsConfirmation: false });
      return;
    }
    response.json({
      reply: "La orden sigue pendiente. Responde «confirmo» para crearla o «cancelo» para descartarla.",
      toolCalls: [],
      needsConfirmation: true,
    });
    return;
  }

  if (!llm) {
    response.status(503).json({
      ok: false,
      reply: "El chat requiere configurar OPENAI_API_KEY en el backend. El demo de herramientas funciona sin esa clave con `npm run demo`.",
      toolCalls: [],
      needsConfirmation: false,
    });
    return;
  }

  session.messages.push({ role: "user", content: message });
  try {
    for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
      const llmResponse = await llm.enviar(session.messages, toolDefinitions);
      session.tokens += llmResponse.inputTokens;
      if (session.tokens > maximumSessionTokens) {
        session.messages.pop();
        response.status(429).json({ ok: false, reply: "Se alcanzó el límite de uso de esta sesión. Inicia una sesión nueva.", toolCalls: turnToolCalls, needsConfirmation: false });
        return;
      }
      session.messages.push(llmResponse.message);
      const calls = llmResponse.message.tool_calls ?? [];
      if (calls.length === 0) {
        const reply = llmResponse.message.content ?? "No recibí una respuesta en texto.";
        session.messages.push({ role: "assistant", content: reply });
        session.needsConfirmation = false;
        response.json({ reply, toolCalls: turnToolCalls, needsConfirmation: false });
        return;
      }

      for (const call of calls) {
        const toolName = call.function.name;
        const args = parseArguments(call.function.arguments);
        if (!isToolKey(toolName)) {
          const result = { ok: false, error: `Herramienta no disponible: ${toolName}` };
          session.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          continue;
        }

        if (toolName === "crear") {
          const safeArgs = { ...asRecord(args), confirmado: false };
          const parsedCreateArgs = z.object(toolSchemas.crear.args).safeParse(safeArgs);
          const rawResult = parsedCreateArgs.success
            ? await toolSchemas.crear.execute(parsedCreateArgs.data, { directory, sessionId })
            : JSON.stringify({ ok: false, error: parsedCreateArgs.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
          const result = parseResult(rawResult);
          const view = makeToolView("oc_crear", safeArgs, result);
          turnToolCalls.push(view);
          session.toolCalls.push(view);
          await logToolCall(sessionId, view);
          session.messages.push({ role: "tool", tool_call_id: call.id, content: rawResult });
          if (!parsedCreateArgs.success) continue;
          if (!result.ok && String(result.error).includes("Se requiere confirmación explícita")) {
            session.pendingConfirmation = { caso: parsedCreateArgs.data.caso, payload: parsedCreateArgs.data.payload };
            session.needsConfirmation = true;
            const reply = "La orden está preparada, pero requiere confirmación humana antes de crearla. Revisa las excepciones y responde «confirmo» para proceder.";
            session.messages.push({ role: "assistant", content: reply });
            response.json({ reply, toolCalls: turnToolCalls, needsConfirmation: true });
            return;
          }
          continue;
        }

        const rawResult = await executeTool(toolName, args, sessionId);
        const result = parseResult(rawResult);
        const view = makeToolView(toolName, args, summarizeResult(toolName, result));
        turnToolCalls.push(view);
        session.toolCalls.push(view);
        await logToolCall(sessionId, view);
        session.messages.push({ role: "tool", tool_call_id: call.id, content: rawResult });
      }
    }

    const reply = "Alcancé el límite de iteraciones del agente. Revisa las llamadas realizadas y dime qué paso deseas continuar.";
    session.messages.push({ role: "assistant", content: reply });
    response.json({ reply, toolCalls: turnToolCalls, needsConfirmation: false });
  } catch (error) {
    const reply = `No pude completar el turno: ${error instanceof Error ? error.message : String(error)}`;
    session.messages.push({ role: "assistant", content: reply });
    response.status(200).json({ ok: false, reply, toolCalls: turnToolCalls, needsConfirmation: session.needsConfirmation });
  }
});

const zChatBody = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().trim().min(1).max(8000),
});

function createSession(): Session {
  return {
    messages: [{ role: "system", content: systemPrompt }],
    toolCalls: [],
    tokens: 0,
    needsConfirmation: false,
  };
}

function createToolDefinitions(): ToolDefinition[] {
  return Object.entries(toolSchemas).map(([exportName, tool]) => ({
    name: `oc_${exportName}`,
    description: tool.description,
    parameters: zodToJsonSchema(z.object(tool.args as z.ZodRawShape)) as Record<string, unknown>,
  }));
}

function isToolKey(name: string): name is ToolKey {
  return name.startsWith("oc_") && name.slice(3) in toolSchemas;
}

async function executeTool(name: ToolKey, args: unknown, sessionId: string): Promise<string> {
  try {
    const ctx = { directory, sessionId };
    const tool = toolSchemas[name];
    const parsed = z.object(tool.args as z.ZodRawShape).parse(args);
    const execute = tool.execute as (toolArgs: never, context: { directory: string; sessionId: string }) => Promise<string>;
    return await execute(parsed as never, ctx);
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function parseResult(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "La herramienta devolvió una respuesta no válida." };
  }
}

function summarizeResult(tool: string, result: Record<string, unknown>): unknown {
  if (result.ok !== true) return result;
  const data = result.data;
  if (tool === "oc_leer_paquete" && typeof data === "object" && data !== null) {
    const packet = data as { solicitud?: { solicitud_id?: string; proveedor_nombre?: string }; faltantes?: string[] };
    return { solicitud_id: packet.solicitud?.solicitud_id, proveedor: packet.solicitud?.proveedor_nombre, faltantes: packet.faltantes };
  }
  return data;
}

function makeToolView(tool: string, args: unknown, result: unknown): ToolCallView {
  return { tool, arguments: args, result, summary: JSON.stringify(result).slice(0, 600) };
}

async function logToolCall(sessionId: string, call: ToolCallView): Promise<void> {
  const file = path.join(getOutputDirectory(directory), "log.jsonl");
  const { mkdir, appendFile } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({ sessionId, ...call, ts: new Date().toISOString() })}\n`, "utf8");
}

function isAffirmative(message: string): boolean {
  return /\b(confirmo|confirmar|confirmado|sí|si|acepto|proceda|adelante|autorizo)\b/i.test(message.trim());
}

function isNegative(message: string): boolean {
  return /\b(no|cancelo|cancelar|detener|descartar)\b/i.test(message.trim());
}

function confirmationReply(result: Record<string, unknown>): string {
  if (result.ok !== true) return `No se pudo crear la orden: ${String(result.error ?? "error desconocido")}`;
  const data = result.data as { numero_oc?: string; fecha?: string; idempotente?: boolean };
  return `Orden de compra ${data.numero_oc} creada en el SAP simulado (${data.fecha}).${data.idempotente ? " Se devolvió la orden existente por idempotencia." : ""}`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const port = positiveInteger(process.env.PORT, 3000);
export default app;

if (process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Agente de órdenes disponible en http://localhost:${port}`);
  });
}
