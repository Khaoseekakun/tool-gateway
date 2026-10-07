import type { ToolGateway } from "../gateway";
import type {
  GeminiFunctionCall,
  GeminiFunctionDeclaration,
  GeminiFunctionResponsePart,
  GeminiTool,
  ToolDefinition,
} from "../types";

export function toGeminiFunctionDeclaration(
  tool: ToolDefinition,
): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

export function toGeminiFunctionDeclarations(
  tools: ToolDefinition[] | ToolGateway,
): GeminiFunctionDeclaration[] {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toGeminiFunctionDeclaration);
}

export function toGeminiTool(
  tools: ToolDefinition[] | ToolGateway,
): GeminiTool {
  return {
    functionDeclarations: toGeminiFunctionDeclarations(tools),
  };
}

export async function executeGeminiFunctionCall<TOutput = unknown>(
  gateway: ToolGateway,
  functionCall: GeminiFunctionCall,
): Promise<GeminiFunctionResponsePart> {
  const output = await gateway.execute<TOutput>(
    functionCall.name,
    functionCall.args ?? {},
  );

  const responseObj: Record<string, unknown> =
    typeof output === "object" && output !== null && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : { result: output };

  return {
    functionResponse: {
      name: functionCall.name,
      response: responseObj,
    },
  };
}

export async function executeGeminiFunctionCalls(
  gateway: ToolGateway,
  functionCalls: GeminiFunctionCall[],
): Promise<GeminiFunctionResponsePart[]> {
  return Promise.all(
    functionCalls.map((call) => executeGeminiFunctionCall(gateway, call)),
  );
}
