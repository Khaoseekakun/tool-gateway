import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  toAnthropicTools,
  executeAnthropicToolUse,
  executeAnthropicToolUses,
} from "../src";

describe("Anthropic Adapter", () => {
  test("แปลง tools ใน gateway เป็น Anthropic format ได้ถูกต้อง", () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "search_db",
      description: "ค้นหาข้อมูลในระบบ",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      execute: (input: { query: string }) => {
        return `Results for ${input.query}`;
      },
    });

    const anthropicTools = toAnthropicTools(gateway);

    expect(anthropicTools).toHaveLength(1);
    expect(anthropicTools[0]).toEqual({
      name: "search_db",
      description: "ค้นหาข้อมูลในระบบ",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    });
  });

  test("executeAnthropicToolUse คืนค่าในรูปแบบ tool_result block", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "add",
      execute: (input: { a: number; b: number }) => {
        return { sum: input.a + input.b };
      },
    });

    const mockToolUse = {
      type: "tool_use" as const,
      id: "toolu_01xyz",
      name: "add",
      input: { a: 15, b: 25 },
    };

    const result = await executeAnthropicToolUse(gateway, mockToolUse);

    expect(result).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_01xyz",
      content: JSON.stringify({ sum: 40 }),
    });
  });

  test("executeAnthropicToolUse กรณี output เป็น string คืนค่า string ตรงๆ", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "greet",
      execute: (name: string) => `Hello, ${name}!`,
    });

    const mockToolUse = {
      type: "tool_use" as const,
      id: "toolu_greet1",
      name: "greet",
      input: "Alex",
    };

    const result = await executeAnthropicToolUse(gateway, mockToolUse);

    expect(result).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_greet1",
      content: "Hello, Alex!",
    });
  });

  test("executeAnthropicToolUses สามารถรันหลาย tool_use blocks พร้อมกันได้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "square",
      execute: (n: number) => n * n,
    });

    const toolUses = [
      {
        type: "tool_use" as const,
        id: "toolu_1",
        name: "square",
        input: 3,
      },
      {
        type: "tool_use" as const,
        id: "toolu_2",
        name: "square",
        input: 9,
      },
    ];

    const results = await executeAnthropicToolUses(gateway, toolUses);

    expect(results).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "9",
      },
      {
        type: "tool_result",
        tool_use_id: "toolu_2",
        content: "81",
      },
    ]);
  });
});
