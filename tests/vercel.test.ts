import { describe, expect, test } from "bun:test";
import { createToolGateway, toVercelTools, toVercelTool } from "../src";

describe("Vercel AI SDK Adapter", () => {
  test("แปลง tools เป็น Record ของ Vercel CoreTool ได้ถูกต้อง", () => {
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

    const vercelTools = toVercelTools(gateway);

    expect(Object.keys(vercelTools)).toEqual(["get_weather"]);
    expect(vercelTools.get_weather.description).toBe("Get city weather");
    expect(vercelTools.get_weather.parameters).toEqual({
      type: "object",
      properties: {
        city: { type: "string" },
      },
      required: ["city"],
    });
  });

  test("การเรียก vercelTool.execute จะสั่งรันผ่าน Gateway และ Middleware", async () => {
    const gateway = createToolGateway();
    const middlewareCalls: string[] = [];

    // Middleware
    gateway.use(async (ctx, next) => {
      middlewareCalls.push(`before_${ctx.name}`);
      const res = await next();
      middlewareCalls.push(`after_${ctx.name}`);
      return res;
    });

    gateway.register({
      name: "calculate_tax",
      execute: (input: { amount: number; rate: number }) => {
        return input.amount * input.rate;
      },
    });

    const vercelTools = toVercelTools(gateway);

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

    const singleTool = toVercelTool(gateway, toolDef);
    expect(singleTool.description).toBe("Say hello to user");

    const res = await singleTool.execute("World");
    expect(res).toBe("Hello, World!");
  });

  test("toVercelTools จะ throw error หากส่ง tools array โดยไม่ใส่ gateway", () => {
    const toolDef = {
      name: "dummy",
      execute: () => "test",
    };

    expect(() => {
      toVercelTools([toolDef]);
    }).toThrow("ToolGateway instance must be provided to toVercelTools");
  });
});
