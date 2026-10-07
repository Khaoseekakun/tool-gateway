import type { ToolGateway } from "../gateway";
import type {
  AnthropicTool,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  ToolDefinition,
} from "../types";

export function toAnthropicTool(tool: ToolDefinition): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? {
      type: "object",
      properties: {},
    },
  };
}

export function toAnthropicTools(
  tools: ToolDefinition[] | ToolGateway,
): AnthropicTool[] {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toAnthropicTool);
}

export async function executeAnthropicToolUse(
  gateway: ToolGateway,
  toolUse: AnthropicToolUseBlock,
): Promise<AnthropicToolResultBlock> {
  const output = await gateway.execute(toolUse.name, toolUse.input);

  return {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content: typeof output === "string" ? output : JSON.stringify(output),
  };
}

export async function executeAnthropicToolUses(
  gateway: ToolGateway,
  toolUses: AnthropicToolUseBlock[],
): Promise<AnthropicToolResultBlock[]> {
  return Promise.all(
    toolUses.map((toolUse) => executeAnthropicToolUse(gateway, toolUse)),
  );
}
