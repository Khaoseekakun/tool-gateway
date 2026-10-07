export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute(input: TInput): Promise<TOutput> | TOutput;
}

export interface ToolSummary {
  name: string;
  description?: string;
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

// ---------------------------------------------------------------------------
// Vercel AI SDK Format
// ---------------------------------------------------------------------------
export interface VercelAITool<TInput = unknown, TOutput = unknown> {
  description?: string;
  parameters: Record<string, unknown>;
  execute: (args: TInput) => Promise<TOutput>;
}

export type VercelAIToolSet = Record<string, VercelAITool>;