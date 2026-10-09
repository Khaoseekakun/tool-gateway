import { describe, expect, test } from "bun:test";
import { createToolGateway, toVercelTools, toVercelTool } from "../src";

// The AI SDK wraps a JSON schema with a runtime marker (Symbol(vercel.ai.schema))
// inside its `jsonSchema()` helper. We assert on that marker to prove the adapter
// produces a schema the SDK will actually accept (a plain object is rejected).
function schemaSymbolOf(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.getOwnPropertySymbols(value).map((s) => s.toString());
}

describe("Vercel AI SDK Adapter", () => {
  test("แปลง tools เป็น Record ของ Vercel tool พร้อม inputSchema ที่ SDK รับรู้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "get_weather",
      description: "Get city weather",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
        required: ["city"],
      },
      execute: (input: { city: string }) => ({
        city: input.city,
        temp: 28,
      }),
    });

    const vercelTools = await toVercelTools(gateway);

    expect(Object.keys(vercelTools)).toEqual(["get_weather"]);
    expect(vercelTools.get_weather.description).toBe("Get city weather");

    // inputSchema must carry the AI SDK marker — a raw JSON object would not.
    const symbols = schemaSymbolOf(vercelTools.get_weather.inputSchema);
    expect(symbols).toContain("Symbol(vercel.ai.schema)");

    // The original JSON schema is preserved inside the wrapper.
    const wrapped = vercelTools.get_weather.inputSchema as {
      jsonSchema: Record<string, unknown>;
    };
    expect(wrapped.jsonSchema).toEqual({
      type: "object",
      properties: {
        city: { type: "string" },
      },
      required: ["city"],
    });
  });

  test("inputSchema fallback เป็น empty object เมื่อ tool ไม่มี parameters", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "ping",
      description: "Ping",
      execute: () => "pong",
    });

    const vercelTools = await toVercelTools(gateway);
    const wrapped = vercelTools.ping.inputSchema as {
      jsonSchema: Record<string, unknown>;
    };
    expect(wrapped.jsonSchema).toEqual({ type: "object", properties: {} });
  });

  test("การเรียก vercelTool.execute จะสั่งรันผ่าน Gateway และ Middleware", async () => {
    const gateway = createToolGateway();
    const middlewareCalls: string[] = [];

    gateway.use(async (ctx, next) => {
      middlewareCalls.push(`before_${ctx.name}`);
      const res = await next();
      middlewareCalls.push(`after_${ctx.name}`);
      return res;
    });

    gateway.register({
      name: "calculate_tax",
      description: "calculate_tax (test)",
      execute: (input: { amount: number; rate: number }) => {
        return input.amount * input.rate;
      },
    });

    const vercelTools = await toVercelTools(gateway);

    const result = await vercelTools.calculate_tax.execute({
      amount: 1000,
      rate: 0.07,
    });

    expect(result).toBe(70);
    expect(middlewareCalls).toEqual([
      "before_calculate_tax",
      "after_calculate_tax",
    ]);
  });

  test("toVercelTool แปลง tool รายตัวและ execute ได้", async () => {
    const gateway = createToolGateway();

    const toolDef = {
      name: "say_hello",
      description: "Say hello to user",
      execute: (name: string) => `Hello, ${name}!`,
    };

    gateway.register(toolDef);

    const singleTool = await toVercelTool(gateway, toolDef);
    expect(singleTool.description).toBe("Say hello to user");

    const res = await singleTool.execute("World");
    expect(res).toBe("Hello, World!");
  });

  test("toVercelTools จะ throw error หากส่ง tools array โดยไม่ใส่ gateway", async () => {
    const toolDef = {
      name: "dummy",
      description: "dummy tool",
      execute: () => "test",
    };

    await expect(toVercelTools([toolDef])).rejects.toThrow(
      "ToolGateway instance must be provided to toVercelTools",
    );
  });

  // End-to-end: the produced tool must survive the AI SDK's own schema
  // validation (asSchema). A plain object — what the old adapter emitted —
  // throws "schema is not a function" here.
  test("inputSchema ผ่านการ validate ของ AI SDK (asSchema) โดยไม่ throw", async () => {
    const { asSchema } = await import("@ai-sdk/provider-utils");

    const gateway = createToolGateway();
    gateway.register({
      name: "get_weather",
      description: "Get city weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      execute: () => ({ temp: 28 }),
    });

    const vercelTools = await toVercelTools(gateway);
    // inputSchema is typed `unknown` (see types.ts); asSchema accepts a schema.
    expect(() =>
      asSchema(
        vercelTools.get_weather.inputSchema as Parameters<
          typeof asSchema
        >[0],
      ),
    ).not.toThrow();
  });
});
