import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  toCohereTools,
  toCohereTool,
  executeCohereToolCall,
  executeCohereToolCalls,
  toCohereV2Tools,
  toCohereV2Tool,
  executeCohereV2ToolCall,
  executeCohereV2ToolCalls,
} from "../src";

describe("Cohere Adapter (v1)", () => {
  test("แปลง parameters properties เป็น Cohere parameter_definitions (Python type notation)", () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "search_news",
      description: "Search latest news",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Search keyword" },
          limit: { type: "integer", description: "Max items" },
          score: { type: "number", description: "Relevance score" },
          verbose: { type: "boolean", description: "Verbose output" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tag filter",
          },
          filter: {
            type: "object",
            description: "Advanced filter",
          },
        },
        required: ["keyword"],
      },
      execute: (input: { keyword: string }) => [
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
          type: "str",
          required: true,
        },
        limit: {
          description: "Max items",
          type: "int",
          required: false,
        },
        score: {
          description: "Relevance score",
          type: "float",
          required: false,
        },
        verbose: {
          description: "Verbose output",
          type: "bool",
          required: false,
        },
        tags: {
          description: "Tag filter",
          type: "List[str]",
          required: false,
        },
        filter: {
          description: "Advanced filter",
          type: "Dict",
          required: false,
        },
      },
    });
  });

  test("executeCohereToolCall รัน tool และคืนผลลัพธ์ในรูปแบบ Cohere tool result", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "convert_currency",
      description: "convert_currency (test)",
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
      description: "prefix (test)",
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

describe("Cohere Adapter (v2 — OpenAI-compatible)", () => {
  test("toCohereV2Tool ส่ง JSON Schema ผ่านตรง (v2 ใช้ format เดียวกับ OpenAI)", () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "search_docs",
      description: "Search documentation",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          top_k: { type: "integer", description: "How many docs" },
        },
        required: ["query"],
      },
      execute: (input: { query: string; top_k?: number }) => ({
        docs: [`result for ${input.query}`],
      }),
    });

    const tools = toCohereV2Tools(gateway);
    expect(tools).toEqual([
      {
        type: "function",
        function: {
          name: "search_docs",
          description: "Search documentation",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              top_k: { type: "integer", description: "How many docs" },
            },
            required: ["query"],
          },
        },
      },
    ]);
  });

  test("toCohereV2Tool fallback เป็น empty object schema เมื่อไม่มี parameters", () => {
    const tool = {
      name: "ping",
      description: "Ping",
      execute: () => ({ pong: true }),
    };

    expect(toCohereV2Tool(tool)).toEqual({
      type: "function",
      function: {
        name: "ping",
        description: "Ping",
        parameters: { type: "object", properties: {} },
      },
    });
  });

  test("executeCohereV2ToolCall parse JSON string arguments และคืน document content block", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "convert_currency",
      description: "convert_currency (test)",
      execute: (input: { amount: number; rate: number }) => ({
        converted: input.amount * input.rate,
      }),
    });

    const toolCall = {
      id: "call_abc123",
      type: "function" as const,
      function: {
        name: "convert_currency",
        arguments: '{"amount":100,"rate":36.5}',
      },
    };

    const result = await executeCohereV2ToolCall(gateway, toolCall);

    expect(result).toEqual({
      tool_call_id: "call_abc123",
      content: [
        {
          type: "document",
          document: { data: '{"converted":3650}' },
        },
      ],
    });
  });

  test("executeCohereV2ToolCall คืน string output ตรงๆ", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "greet",
      description: "greet (test)",
      execute: () => "hello world",
    });

    const result = await executeCohereV2ToolCall(gateway, {
      id: "call_x",
      type: "function",
      function: { name: "greet", arguments: "{}" },
    });

    expect(result.content).toEqual([
      { type: "document", document: { data: "hello world" } },
    ]);
  });

  test("executeCohereV2ToolCall throw เมื่อ arguments เป็น JSON ที่ parse ไม่ได้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "greet",
      description: "greet (test)",
      execute: () => "hello",
    });

    await expect(
      executeCohereV2ToolCall(gateway, {
        id: "call_y",
        type: "function",
        function: { name: "greet", arguments: "not-json" },
      }),
    ).rejects.toThrow('Failed to parse arguments for tool "greet": not-json');
  });

  test("executeCohereV2ToolCalls รันหลาย tool calls พร้อมกัน", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "prefix",
      description: "prefix (test)",
      execute: (input: { str: string }) => ({ val: `item_${input.str}` }),
    });

    const calls = [
      {
        id: "c1",
        type: "function" as const,
        function: { name: "prefix", arguments: '{"str":"1"}' },
      },
      {
        id: "c2",
        type: "function" as const,
        function: { name: "prefix", arguments: '{"str":"2"}' },
      },
    ];

    const results = await executeCohereV2ToolCalls(gateway, calls);

    expect(results).toHaveLength(2);
    expect(results[0].tool_call_id).toBe("c1");
    expect(results[1].content[0].document.data).toBe('{"val":"item_2"}');
  });
});
