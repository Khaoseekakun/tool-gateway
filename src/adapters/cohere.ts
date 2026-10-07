import type { ToolGateway } from "../gateway";
import type {
  CohereParameterDefinition,
  CohereTool,
  CohereToolCall,
  CohereToolResult,
  ToolDefinition,
} from "../types";

export function toCohereTool(tool: ToolDefinition): CohereTool {
  let parameter_definitions: Record<string, CohereParameterDefinition> | undefined;

  if (tool.parameters && typeof tool.parameters === "object") {
    const rawProps =
      (tool.parameters.properties as Record<string, Record<string, unknown>>) ?? {};
    const requiredList = Array.isArray(tool.parameters.required)
      ? (tool.parameters.required as string[])
      : [];

    parameter_definitions = {};
    for (const [key, prop] of Object.entries(rawProps)) {
      parameter_definitions[key] = {
        description: typeof prop?.description === "string" ? prop.description : "",
        type: typeof prop?.type === "string" ? prop.type : "str",
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
