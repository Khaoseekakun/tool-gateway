import type { ToolGateway } from "./gateway";
import type {
  AnthropicTool,
  AnthropicToolUseBlock,
  CohereTool,
  CohereToolCall,
  CohereV2Tool,
  CohereV2ToolCall,
  GeminiFunctionCall,
  GeminiFunctionDeclaration,
  GeminiTool,
  OpenAITool,
  OpenAIToolCall,
  ToolDefinition,
  VercelAIToolSet,
} from "./types";
import { toOpenAITools } from "./adapters/openai";
import { toAnthropicTools } from "./adapters/anthropic";
import { toGeminiTool, toGeminiFunctionDeclarations } from "./adapters/gemini";
import { toCohereTools, toCohereV2Tools } from "./adapters/cohere";
import { toVercelTools } from "./adapters/vercel";
import {
  executeOpenAIToolCall,
  executeOpenAIToolCallsSettled,
} from "./adapters/openai";
import {
  executeAnthropicToolUse,
  executeAnthropicToolUsesSettled,
} from "./adapters/anthropic";
import {
  executeGeminiFunctionCall,
  executeGeminiFunctionCallsSettled,
} from "./adapters/gemini";
import {
  executeCohereToolCall,
  executeCohereToolCallsSettled,
  executeCohereV2ToolCall,
  executeCohereV2ToolCallsSettled,
} from "./adapters/cohere";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ProviderId =
  | "openai" // OpenAI & compatible (Groq, Ollama, DeepSeek)
  | "cohere-v2" // same wire format as openai, but returns document blocks
  | "anthropic"
  | "gemini"
  | "cohere-v1";

/**
 * Detect which provider a single tool call belongs to by inspecting its
 * shape. Cohere v2 is wire-identical to OpenAI, so it maps to "openai".
 */
export function detectProvider(call: unknown): ProviderId {
  if (!isRecord(call)) {
    throw new Error(
      `Unrecognized tool call: expected an object, got ${call === null ? "null" : typeof call}`,
    );
  }
  if (call.type === "tool_use" && typeof call.id === "string") {
    return "anthropic";
  }
  if (
    typeof call.id === "string" &&
    isRecord(call.function) &&
    typeof call.function.name === "string"
  ) {
    // OpenAI / compatible and Cohere v2 (same wire format).
    return "openai";
  }
  if (typeof call.name === "string" && "args" in call) {
    return "gemini";
  }
  if (typeof call.name === "string" && "parameters" in call) {
    return "cohere-v1";
  }
  throw new Error(
    'Unrecognized tool call format. Expected an OpenAI/Cohere-v2 call ({ id, function: { name, arguments } }), an Anthropic tool_use ({ type: "tool_use", id, name, input }), a Gemini function call ({ name, args }), or a Cohere v1 call ({ name, parameters }).',
  );
}

export interface RunToolCallsOptions {
  /**
   * Skip automatic provider detection and force a specific provider.
   * Useful when a call is ambiguous or you want to avoid the per-call check.
   */
  provider?: ProviderId;
}

/**
 * The one-call API: run provider tool calls through the gateway.
 *
 * - Auto-detects each call's provider format (OpenAI-compatible, Anthropic,
 *   Gemini, Cohere v1) and returns results in that provider's native format.
 * - Input validation (JSON Schema) and timeouts are applied by the gateway.
 * - Fail-soft: a failing tool never rejects the batch; its error is embedded
 *   in the result so the model can read it and retry.
 *
 * ```ts
 * const results = await runToolCalls(gateway, modelToolCalls);
 * // `results` is ready to append back into the model conversation.
 * ```
 */
export async function runToolCalls(
  gateway: ToolGateway,
  calls: unknown[],
  options: RunToolCallsOptions = {},
): Promise<unknown[]> {
  const provider =
    options.provider ??
    (calls.length > 0 ? detectProvider(calls[0]) : undefined);

  switch (provider) {
    case undefined:
      return [];
    case "openai":
      return executeOpenAIToolCallsSettled(
        gateway,
        calls as OpenAIToolCall[],
      );
    case "cohere-v2":
      return executeCohereV2ToolCallsSettled(
        gateway,
        calls as CohereV2ToolCall[],
      );
    case "anthropic":
      return executeAnthropicToolUsesSettled(
        gateway,
        calls as AnthropicToolUseBlock[],
      );
    case "gemini":
      return executeGeminiFunctionCallsSettled(
        gateway,
        calls as GeminiFunctionCall[],
      );
    case "cohere-v1":
      return executeCohereToolCallsSettled(
        gateway,
        calls as CohereToolCall[],
      );
    default:
      throw new Error(`Unsupported provider: ${String(provider)}`);
  }
}

/**
 * Re-exported for callers who want a single entry point for single calls.
 */
export async function runToolCall(
  gateway: ToolGateway,
  call: unknown,
  options: RunToolCallsOptions = {},
): Promise<unknown> {
  const provider = options.provider ?? detectProvider(call);
  switch (provider) {
    case "openai":
      return executeOpenAIToolCall(gateway, call as OpenAIToolCall);
    case "cohere-v2":
      return executeCohereV2ToolCall(gateway, call as CohereV2ToolCall);
    case "anthropic":
      return executeAnthropicToolUse(gateway, call as AnthropicToolUseBlock);
    case "gemini":
      return executeGeminiFunctionCall(gateway, call as GeminiFunctionCall);
    case "cohere-v1":
      return executeCohereToolCall(gateway, call as CohereToolCall);
    default:
      throw new Error(`Unsupported provider: ${String(provider)}`);
  }
}

// ---------------------------------------------------------------------------
// Schema export — one function for every provider
// ---------------------------------------------------------------------------

export type ToolFormat =
  | "openai" // OpenAI & compatible (Groq, Ollama, DeepSeek) and Cohere v2
  | "anthropic"
  | "gemini"
  | "gemini-declarations"
  | "cohere" // legacy v1 parameter_definitions
  | "cohere-v2"
  | "vercel";

/** The resolved type each `ToolFormat` produces. */
export type ToolsByFormat = {
  openai: OpenAITool[];
  anthropic: AnthropicTool[];
  gemini: GeminiTool;
  "gemini-declarations": GeminiFunctionDeclaration[];
  cohere: CohereTool[];
  "cohere-v2": CohereV2Tool[];
  vercel: VercelAIToolSet;
};

/**
 * Export the gateway's tools in any provider's format with one call:
 *
 * ```ts
 * const tools = await toTools(gateway, "anthropic"); // AnthropicTool[]
 * ```
 *
 * The return type is inferred from the format literal, so you get full
 * type-safety per provider. The "vercel" format returns a tool set keyed by
 * tool name (and loads the `ai` package lazily); every other format returns
 * an array (or, for "gemini", a single `{ functionDeclarations }` object).
 *
 * Note: "vercel" requires a `ToolGateway` instance (not a plain array)
 * because the generated `execute` callbacks dispatch back through it.
 */
export async function toTools<F extends ToolFormat>(
  tools: F extends "vercel" ? ToolGateway : ToolDefinition[] | ToolGateway,
  format: F,
): Promise<ToolsByFormat[F]> {
  switch (format) {
    case "openai":
      return toOpenAITools(tools) as ToolsByFormat[F];
    case "anthropic":
      return toAnthropicTools(tools) as ToolsByFormat[F];
    case "gemini":
      return toGeminiTool(tools) as ToolsByFormat[F];
    case "gemini-declarations":
      return toGeminiFunctionDeclarations(tools) as ToolsByFormat[F];
    case "cohere":
      return toCohereTools(tools) as ToolsByFormat[F];
    case "cohere-v2":
      return toCohereV2Tools(tools) as ToolsByFormat[F];
    case "vercel":
      return toVercelTools(tools) as Promise<ToolsByFormat[F]>;
    default:
      throw new Error(`Unsupported tool format: ${String(format)}`);
  }
}
