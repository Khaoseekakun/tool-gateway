import type { ToolGateway } from "../gateway";
import type {
  CohereParameterDefinition,
  CohereTool,
  CohereToolCall,
  CohereToolResult,
  CohereV2Tool,
  CohereV2ToolCall,
  CohereV2ToolResult,
  ToolDefinition,
} from "../types";
import { toErrorMessage } from "./shared";

type JsonSchemaProperty = Record<string, unknown> | undefined;

/**
 * Convert a JSON Schema property type to Cohere v1 Python-type notation.
 * Cohere's v1 Chat API does not accept raw JSON Schema type names such as
 * `string` or `integer`; it expects Python notation like `str`, `int`,
 * `List[str]`, and `Dict`.
 */
function toJsonSchemaTypeToCohereType(prop: JsonSchemaProperty): string {
  const type = typeof prop?.type === "string" ? prop.type : undefined;

  switch (type) {
    case "string":
      return "str";
    case "integer":
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "array": {
      const items = prop?.items as Record<string, unknown> | undefined;
      const itemType = typeof items?.type === "string" ? items.type : undefined;
      return itemType ? `List[${typeToCohereScalar(itemType)}]` : "List";
    }
    case "object":
      return "Dict";
    default:
      // Unknown or missing types fall back to a dynamic (free-form) parameter.
      return "dynamic";
  }
}

function typeToCohereScalar(type: string): string {
  switch (type) {
    case "string":
      return "str";
    case "integer":
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    default:
      return type;
  }
}

export function toCohereTool(tool: ToolDefinition): CohereTool {
  let parameter_definitions:
    | Record<string, CohereParameterDefinition>
    | undefined;

  if (tool.parameters && typeof tool.parameters === "object") {
    const rawProps =
      (tool.parameters.properties as Record<string, JsonSchemaProperty>) ?? {};
    const requiredList = Array.isArray(tool.parameters.required)
      ? (tool.parameters.required as string[])
      : [];

    parameter_definitions = {};
    for (const [key, prop] of Object.entries(rawProps)) {
      parameter_definitions[key] = {
        description:
          typeof prop?.description === "string" ? prop.description : "",
        type: toJsonSchemaTypeToCohereType(prop),
        required: requiredList.includes(key),
      };
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameter_definitions,
  };
}

export function toCohereTools(
  tools: ToolDefinition[] | ToolGateway,
): CohereTool[] {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toCohereTool);
}

export async function executeCohereToolCall<TOutput = unknown>(
  gateway: ToolGateway,
  toolCall: CohereToolCall,
): Promise<CohereToolResult> {
  const output = await gateway.execute<TOutput>(
    toolCall.name,
    toolCall.parameters ?? {},
  );

  const outputObj: Record<string, unknown> =
    typeof output === "object" && output !== null && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : { result: output };

  return {
    call: toolCall,
    outputs: [outputObj],
  };
}

export async function executeCohereToolCalls(
  gateway: ToolGateway,
  toolCalls: CohereToolCall[],
): Promise<CohereToolResult[]> {
  return Promise.all(
    toolCalls.map((call) => executeCohereToolCall(gateway, call)),
  );
}

/**
 * Fail-soft variant: a failing tool yields `{ call, outputs: [{ error }] }`
 * (same shape as success) instead of rejecting the whole batch.
 */
export async function executeCohereToolCallsSettled(
  gateway: ToolGateway,
  toolCalls: CohereToolCall[],
): Promise<CohereToolResult[]> {
  return Promise.all(
    toolCalls.map(async (call) => {
      try {
        return await executeCohereToolCall(gateway, call);
      } catch (error) {
        return { call, outputs: [{ error: toErrorMessage(error) }] };
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Cohere v2 (api.cohere.ai/v2/chat) — OpenAI-compatible tool format
// ---------------------------------------------------------------------------

export function toCohereV2Tool(tool: ToolDefinition): CohereV2Tool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {
        type: "object",
        properties: {},
      },
    },
  };
}

export function toCohereV2Tools(
  tools: ToolDefinition[] | ToolGateway,
): CohereV2Tool[] {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toCohereV2Tool);
}

export async function executeCohereV2ToolCall<TOutput = unknown>(
  gateway: ToolGateway,
  toolCall: CohereV2ToolCall,
): Promise<CohereV2ToolResult> {
  const name = toolCall.function.name;
  let input: unknown = {};

  if (toolCall.function.arguments) {
    try {
      input = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error(
        `Failed to parse arguments for tool "${name}": ${toolCall.function.arguments}`,
      );
    }
  }

  const output = await gateway.execute<TOutput>(name, input);
  const data =
    typeof output === "string" ? output : JSON.stringify(output);

  return {
    tool_call_id: toolCall.id,
    content: [{ type: "document", document: { data } }],
  };
}

export async function executeCohereV2ToolCalls(
  gateway: ToolGateway,
  toolCalls: CohereV2ToolCall[],
): Promise<CohereV2ToolResult[]> {
  return Promise.all(
    toolCalls.map((call) => executeCohereV2ToolCall(gateway, call)),
  );
}

/**
 * Fail-soft variant: a failing tool yields a `CohereV2ToolResult` whose
 * document data is `{"error": "..."}` (same shape as success) instead of
 * rejecting the whole batch.
 */
export async function executeCohereV2ToolCallsSettled(
  gateway: ToolGateway,
  toolCalls: CohereV2ToolCall[],
): Promise<CohereV2ToolResult[]> {
  return Promise.all(
    toolCalls.map(async (call) => {
      try {
        return await executeCohereV2ToolCall(gateway, call);
      } catch (error) {
        return {
          tool_call_id: call.id,
          content: [
            {
              type: "document",
              document: { data: JSON.stringify({ error: toErrorMessage(error) }) },
            },
          ],
        };
      }
    }),
  );
}
