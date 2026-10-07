import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  toOpenAITools,
  executeOpenAIToolCall,
  executeOpenAIToolCalls,
} from "../src";

describe("OpenAI Adapter", () => {
  test("แปลง tools ใน gateway เป็น OpenAI format ได้ถูกต้อง", () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "get_weather",
      description: "ดึงข้อมูลสภาพอากาศตามชื่อเมือง",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
        required: ["city"],
      },
      execute: (input: { city: string }) => {
        return { weather: "sunny", city: input.city };
      },
    });

    const openAITools = toOpenAITools(gateway);

    expect(openAITools).toHaveLength(1);
    expect(openAITools[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "ดึงข้อมูลสภาพอากาศตามชื่อเมือง",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
    });
  });

  test("executeOpenAIToolCall สามารถ parse arguments และคืน tool_call_id ได้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "calculate",
      execute: (input: { x: number; y: number }) => {
        return input.x * input.y;
      },
    });

    const mockToolCall = {
      id: "call_abc123",
      type: "function" as const,
      function: {
        name: "calculate",
        arguments: JSON.stringify({ x: 5, y: 4 }),
      },
    };

    const result = await executeOpenAIToolCall<number>(gateway, mockToolCall);

    expect(result.tool_call_id).toBe("call_abc123");
    expect(result.output).toBe(20);
  });

  test("executeOpenAIToolCalls สามารถรันหลาย tool calls พร้อมกันได้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "echo",
      execute: (input: { message: string }) => input.message,
    });

    const toolCalls = [
      {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "echo",
          arguments: JSON.stringify({ message: "hello" }),
        },
      },
      {
        id: "call_2",
        type: "function" as const,
        function: {
          name: "echo",
          arguments: JSON.stringify({ message: "world" }),
        },
      },
    ];

    const results = await executeOpenAIToolCalls(gateway, toolCalls);

    expect(results).toHaveLength(2);
    expect(results).toEqual([
      { tool_call_id: "call_1", output: "hello" },
      { tool_call_id: "call_2", output: "world" },
    ]);
  });
});