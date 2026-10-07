import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  toCohereTools,
  toCohereTool,
  executeCohereToolCall,
  executeCohereToolCalls,
} from "../src";

describe("Cohere Adapter", () => {
  test("แปลง parameters properties เป็น Cohere parameter_definitions", () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "search_news",
      description: "Search latest news",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Search keyword" },
          limit: { type: "integer", description: "Max items" },
        },
        required: ["keyword"],
      },
      execute: (input: { keyword: string; limit?: number }) => [
        `News about ${input.keyword}`,
      ],
    });

    const cohereTools = toCohereTools(gateway);
    expect(cohereTools).toHaveLength(1);
    expect(cohereTools[0]).toEqual({
      name: "search_news",
      description: "Search latest news",
      parameter_definitions: {
        keyword: {
          description: "Search keyword",
          type: "string",
          required: true,
        },
        limit: {
          description: "Max items",
          type: "integer",
          required: false,
        },
      },
    });
  });

  test("executeCohereToolCall รัน tool และคืนผลลัพธ์ในรูปแบบ Cohere tool result", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "convert_currency",
      execute: (input: { amount: number; rate: number }) => ({
        converted: input.amount * input.rate,
      }),
    });

    const toolCall = {
      name: "convert_currency",
      parameters: { amount: 100, rate: 36.5 },
    };

    const result = await executeCohereToolCall(gateway, toolCall);

    expect(result).toEqual({
      call: toolCall,
      outputs: [{ converted: 3650 }],
    });
  });

  test("executeCohereToolCalls สามารถรันหลาย tool calls พร้อมกันได้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "prefix",
      execute: (input: { str: string }) => ({ val: `item_${input.str}` }),
    });

    const calls = [
      { name: "prefix", parameters: { str: "1" } },
      { name: "prefix", parameters: { str: "2" } },
    ];

    const results = await executeCohereToolCalls(gateway, calls);

    expect(results).toHaveLength(2);
    expect(results[0].outputs).toEqual([{ val: "item_1" }]);
    expect(results[1].outputs).toEqual([{ val: "item_2" }]);
  });
});
