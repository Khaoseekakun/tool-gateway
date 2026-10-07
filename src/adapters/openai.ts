import type { ToolGateway } from "../gateway";
import type { OpenAITool, OpenAIToolCall, ToolDefinition } from "../types";

export function toOpenAITool(tool: ToolDefinition): OpenAITool {
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

export function toOpenAITools(tools: ToolDefinition[] | ToolGateway): OpenAITool[] {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toOpenAITool);
}

export async function executeOpenAIToolCall<TOutput = unknown>(
  gateway: ToolGateway,
  toolCall: OpenAIToolCall,
): Promise<{ tool_call_id: string; output: TOutput }> {
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
  return {
    tool_call_id: toolCall.id,
    output,
  };
}

export async function executeOpenAIToolCalls(
  gateway: ToolGateway,
  toolCalls: OpenAIToolCall[],
): Promise<Array<{ tool_call_id: string; output: unknown }>> {
  return Promise.all(
    toolCalls.map((toolCall) => executeOpenAIToolCall(gateway, toolCall)),
  );
}