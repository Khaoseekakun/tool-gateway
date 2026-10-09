import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  detectProvider,
  runToolCalls,
  runToolCall,
  toTools,
  type ToolFormat,
} from "../src";

function makeGateway() {
  const gateway = createToolGateway();
  gateway.register({
    name: "ok",
    description: "works fine",
    execute: (input: { v: number }) => ({ doubled: input.v * 2 }),
  });
  gateway.register({
    name: "boom",
    description: "always fails",
    execute: () => {
      throw new Error("kaboom");
    },
  });
  return gateway;
}

describe("detectProvider", () => {
  test("detects OpenAI / Cohere v2 (identical wire format)", () => {
    expect(
      detectProvider({
        id: "c1",
        type: "function",
        function: { name: "ok", arguments: "{}" },
      }),
    ).toBe("openai");
  });

  test("detects Anthropic tool_use", () => {
    expect(
      detectProvider({
        type: "tool_use",
        id: "u1",
        name: "ok",
        input: {},
      }),
    ).toBe("anthropic");
  });

  test("detects Gemini function call", () => {
    expect(detectProvider({ name: "ok", args: {} })).toBe("gemini");
  });

  test("detects Cohere v1 call", () => {
    expect(detectProvider({ name: "ok", parameters: {} })).toBe("cohere-v1");
  });

  test("throws a clear error for unrecognized shapes", () => {
    expect(() => detectProvider({ foo: "bar" })).toThrow(
      "Unrecognized tool call format",
    );
    expect(() => detectProvider("nope")).toThrow("Unrecognized tool call");
  });
});

describe("runToolCalls (unified entry point)", () => {
  test("auto-detects and runs OpenAI-style calls, fail-soft", async () => {
    const gateway = makeGateway();
    const results = (await runToolCalls(gateway, [
      {
        id: "c1",
        type: "function",
        function: { name: "ok", arguments: '{"v":21}' },
      },
      {
        id: "c2",
        type: "function",
        function: { name: "boom", arguments: "{}" },
      },
    ])) as Array<Record<string, unknown>>;

    expect(results[0]).toEqual({
      tool_call_id: "c1",
      content: '{"doubled":42}',
      output: { doubled: 42 },
    });
    expect(results[1]).toEqual({
      tool_call_id: "c2",
      content: '{"error":"kaboom"}',
      output: null,
      error: "kaboom",
    });
  });

  test("auto-detects and runs Anthropic calls", async () => {
    const gateway = makeGateway();
    const results = (await runToolCalls(gateway, [
      { type: "tool_use", id: "u1", name: "boom", input: {} },
    ])) as Array<Record<string, unknown>>;

    expect(results[0]).toEqual({
      type: "tool_result",
      tool_use_id: "u1",
      content: '{"error":"kaboom"}',
    });
  });

  test("auto-detects and runs Gemini calls", async () => {
    const gateway = makeGateway();
    const results = (await runToolCalls(gateway, [
      { name: "boom", args: {} },
    ])) as Array<Record<string, unknown>>;

    expect(results[0]).toEqual({
      functionResponse: { name: "boom", response: { error: "kaboom" } },
    });
  });

  test("auto-detects and runs Cohere v1 calls", async () => {
    const gateway = makeGateway();
    const results = (await runToolCalls(gateway, [
      { name: "boom", parameters: {} },
    ])) as Array<Record<string, unknown>>;

    expect(results[0]).toEqual({
      call: { name: "boom", parameters: {} },
      outputs: [{ error: "kaboom" }],
    });
  });

  test("empty batch resolves to empty array", async () => {
    const gateway = makeGateway();
    await expect(runToolCalls(gateway, [])).resolves.toEqual([]);
  });

  test("explicit provider: cohere-v2 returns document blocks", async () => {
    const gateway = makeGateway();
    // Cohere v2 calls are wire-identical to OpenAI, so the format must be
    // forced explicitly to get the Cohere v2 document-block result shape.
    const results = (await runToolCalls(
      gateway,
      [
        {
          id: "c1",
          type: "function",
          function: { name: "ok", arguments: '{"v":2}' },
        },
      ],
      { provider: "cohere-v2" },
    )) as Array<Record<string, unknown>>;

    expect(results[0]).toEqual({
      tool_call_id: "c1",
      content: [{ type: "document", document: { data: '{"doubled":4}' } }],
    });
  });

  test("explicit provider option bypasses detection", async () => {
    const gateway = makeGateway();
    const results = (await runToolCalls(
      gateway,
      [{ type: "tool_use", id: "u1", name: "boom", input: {} }],
      { provider: "gemini" },
    )) as Array<Record<string, unknown>>;

    // Forced through the Gemini executor even though the shape is Anthropic.
    expect(results[0]).toEqual({
      functionResponse: {
        name: "boom",
        response: { error: "kaboom" },
      },
    });
  });

  test("validation errors surface as per-call errors (not batch rejection)", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "typed",
      description: "needs a number",
      parameters: {
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
      },
      execute: (input: { n: number }) => input.n,
    });

    const results = (await runToolCalls(gateway, [
      {
        id: "c1",
        type: "function",
        function: { name: "typed", arguments: '{"n":"not-a-number"}' },
      },
    ])) as Array<Record<string, unknown>>;

    expect(results[0].output).toBeNull();
    expect(results[0].error).toContain("expected type number");
  });

  test("runToolCall handles a single call of any provider", async () => {
    const gateway = makeGateway();

    const openai = await runToolCall(gateway, {
      id: "c1",
      type: "function",
      function: { name: "ok", arguments: '{"v":5}' },
    });
    expect(openai).toEqual({
      tool_call_id: "c1",
      content: '{"doubled":10}',
      output: { doubled: 10 },
    });

    const gemini = await runToolCall(gateway, { name: "ok", args: { v: 5 } });
    expect(gemini).toEqual({
      functionResponse: { name: "ok", response: { doubled: 10 } },
    });
  });
});

describe("toTools (unified schema export)", () => {
  const gateway = createToolGateway();
  gateway.register({
    name: "get_weather",
    description: "Get city weather",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
    execute: (input: { city: string }) => ({ city: input.city, temp: 30 }),
  });

  test("openai returns OpenAITool[]", async () => {
    const tools = await toTools(gateway, "openai");
    expect(tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get city weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      },
    ]);
  });

  test("anthropic returns AnthropicTool[]", async () => {
    const tools = await toTools(gateway, "anthropic");
    expect(tools[0].name).toBe("get_weather");
    expect(tools[0].input_schema).toBeDefined();
  });

  test("gemini wraps declarations", async () => {
    const tools = await toTools(gateway, "gemini");
    expect(tools.functionDeclarations).toHaveLength(1);
  });

  test("cohere v1 uses Python type notation", async () => {
    const tools = await toTools(gateway, "cohere");
    expect(tools[0].parameter_definitions?.city.type).toBe("str");
  });

  test("cohere-v2 is OpenAI-compatible", async () => {
    const tools = await toTools(gateway, "cohere-v2");
    expect(tools[0].type).toBe("function");
    expect(tools[0].function).toMatchObject({ name: "get_weather" });
  });

  test("vercel produces an SDK-compatible tool set", async () => {
    const tools = await toTools(gateway, "vercel");
    expect(tools.get_weather.description).toBe("Get city weather");
    const symbols = Object.getOwnPropertySymbols(
      tools.get_weather.inputSchema,
    ).map((s) => s.toString());
    expect(symbols).toContain("Symbol(vercel.ai.schema)");
  });

  test("unknown format throws at runtime", async () => {
    const bad = "nope" as unknown as ToolFormat;
    await expect(toTools(gateway, bad)).rejects.toThrow(
      "Unsupported tool format",
    );
  });
});
