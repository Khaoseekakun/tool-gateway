import type { ToolGateway } from "../gateway";
import type { ToolDefinition, VercelAITool, VercelAIToolSet } from "../types";

export function toVercelTool(
  gateway: ToolGateway,
  tool: ToolDefinition,
): VercelAITool {
  return {
    description: tool.description,
    parameters: tool.parameters ?? {
      type: "object",
      properties: {},
    },
    execute: (args: unknown) => gateway.execute(tool.name, args),
  };
}

export function toVercelTools(
  tools: ToolDefinition[] | ToolGateway,
  gateway?: ToolGateway,
): VercelAIToolSet {
  const gw = "getAll" in tools ? (tools as ToolGateway) : gateway;
  if (!gw) {
    throw new Error("ToolGateway instance must be provided to toVercelTools");
  }

  const toolList = "getAll" in tools ? tools.getAll() : tools;
  const toolSet: VercelAIToolSet = {};

  for (const tool of toolList) {
    toolSet[tool.name] = toVercelTool(gw, tool);
  }

  return toolSet;
}
