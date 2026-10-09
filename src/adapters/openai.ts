import type { ToolGateway } from "../gateway";
import type { OpenAITool, OpenAIToolCall, ToolDefinition } from "../types";
import { toErrorMessage, toToolContent } from "./shared";

export type OpenAIToolCallResult =
  | {
      tool_call_id: string;
      /** Ready to send as the `content` of a `role: "tool"` message. */
      content: string;
      output: unknown;
      error?: undefined;
    }
  | {
      tool_call_id: string;
      content: string;
      output: null;
      error: string;
    };

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
): Promise<{ tool_call_id: string; content: string; output: TOutput }> {
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
    // `content` is a string ready to paste into a `role: "tool"` message;
    // `output` is the raw value for your own use.
    content: toToolContent(output),
    output,
  };
}

export async function executeOpenAIToolCalls(
  gateway: ToolGateway,
  toolCalls: OpenAIToolCall[],
): Promise<
  Array<{ tool_call_id: string; content: string; output: unknown }>
> {
  return Promise.all(
    toolCalls.map((toolCall) => executeOpenAIToolCall(gateway, toolCall)),
  );
}

/**
 * Fail-soft variant: a failing tool returns `{ tool_call_id, output: null,
 * error }` instead of rejecting the whole batch. Use this in agent loops so
 * the model receives a per-call error and can retry with corrected arguments.
 */
export async function executeOpenAIToolCallsSettled(
  gateway: ToolGateway,
  toolCalls: OpenAIToolCall[],
): Promise<OpenAIToolCallResult[]> {
  return Promise.all(
    toolCalls.map(async (toolCall): Promise<OpenAIToolCallResult> => {
      try {
        return await executeOpenAIToolCall(gateway, toolCall);
      } catch (error) {
        const message = toErrorMessage(error);
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: message }),
          output: null,
          error: message,
        };
      }
    }),
  );
}