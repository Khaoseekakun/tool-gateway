export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  /**
   * Required: every supported provider uses it to decide when to call the
   * tool, and the Anthropic API rejects tools without a description.
   */
  description: string;
  parameters?: Record<string, unknown>;
  /**
   * Optional per-tool execution timeout in milliseconds. Overrides the
   * gateway's `defaultTimeout`. Exceeding it rejects with
   * `ToolTimeoutError`. Note: the timer cannot cancel in-flight side
   * effects — it only bounds how long the caller waits.
   */
  timeout?: number;
  execute(input: TInput): Promise<TOutput> | TOutput;
}

export interface ToolSummary {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export interface ToolExecutionContext<TInput = unknown> {
  name: string;
  input: TInput;
  tool: ToolDefinition;
}

export type ToolMiddleware = (
  context: ToolExecutionContext,
  next: () => Promise<unknown>,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// OpenAI Format
// ---------------------------------------------------------------------------
export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export type OpenAiFunction = OpenAIFunction;

export interface OpenAITool {
  type: "function";
  function: OpenAIFunction;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) Format
// ---------------------------------------------------------------------------
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Google Gemini Format
// ---------------------------------------------------------------------------
export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface GeminiFunctionResponsePart {
  functionResponse: GeminiFunctionResponse;
}

// ---------------------------------------------------------------------------
// Cohere Format
// ---------------------------------------------------------------------------
export interface CohereParameterDefinition {
  description?: string;
  type: string;
  required?: boolean;
}

export interface CohereTool {
  name: string;
  description?: string;
  parameter_definitions?: Record<string, CohereParameterDefinition>;
}

export interface CohereToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface CohereToolResult {
  call: CohereToolCall;
  outputs: Array<Record<string, unknown>>;
}

// Cohere v2 (api.cohere.ai/v2/chat) uses the OpenAI-compatible tool format:
// OpenAI/Anthropic-style JSON Schema for definitions and JSON-string arguments
// in tool calls. Results are returned as `document` content blocks.
export interface CohereV2Function {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface CohereV2Tool {
  type: "function";
  function: CohereV2Function;
}

export interface CohereV2ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface CohereV2ToolResult {
  tool_call_id: string;
  content: Array<{ type: "document"; document: { data: string } }>;
}

// ---------------------------------------------------------------------------
// Vercel AI SDK Format
// ---------------------------------------------------------------------------
// `inputSchema` holds the JSON schema wrapped by the AI SDK's `jsonSchema()`
// helper (see adapters/vercel.ts). It is typed `unknown` because `ai` is an
// optional peer dependency loaded lazily — the returned value is a runtime
// marker object, not the raw JSON schema.
export interface VercelAITool<TInput = unknown, TOutput = unknown> {
  description?: string;
  inputSchema: unknown;
  execute: (
    args: TInput,
    options?: { toolCallId?: string; abortSignal?: AbortSignal },
  ) => Promise<TOutput> | TOutput;
}

export type VercelAIToolSet = Record<string, VercelAITool>;