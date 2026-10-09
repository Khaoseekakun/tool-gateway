import type { ToolGateway } from "../gateway";
import type {
  AnthropicTool,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  ToolDefinition,
} from "../types";
import { toErrorMessage, toToolContent } from "./shared";

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
    content: toToolContent(output),
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

/**
 * Fail-soft variant: a failing tool yields a `tool_result` whose content is
 * `{"error": "..."}` (same block shape as success) instead of rejecting the
 * whole batch, so the error can be sent back to Claude for self-correction.
 */
export async function executeAnthropicToolUsesSettled(
  gateway: ToolGateway,
  toolUses: AnthropicToolUseBlock[],
): Promise<AnthropicToolResultBlock[]> {
  return Promise.all(
    toolUses.map(async (toolUse) => {
      try {
        return await executeAnthropicToolUse(gateway, toolUse);
      } catch (error) {
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: toErrorMessage(error) }),
        };
      }
    }),
  );
}
