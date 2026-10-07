import { describe, expect, test } from "bun:test";
import { createToolGateway, executeOpenAIToolCalls } from "../src";

describe("Middleware & Lifecycle Hooks", () => {
  test("Middleware ทำงานตามลำดับ Onion model (before -> next -> after)", async () => {
    const gateway = createToolGateway();
    const trace: string[] = [];

    gateway
      .use(async (ctx, next) => {
        trace.push(`m1_before_${ctx.name}`);
        const result = await next();
        trace.push(`m1_after_${ctx.name}`);
        return result;
      })
      .use(async (ctx, next) => {
        trace.push(`m2_before_${ctx.name}`);
        const result = await next();
        trace.push(`m2_after_${ctx.name}`);
        return result;
      });

    gateway.register({
      name: "hello",
      execute: (name: string) => {
        trace.push(`exec_${name}`);
        return `Hello, ${name}`;
      },
    });

    const res = await gateway.execute("hello", "World");

    expect(res).toBe("Hello, World");
    expect(trace).toEqual([
      "m1_before_hello",
      "m2_before_hello",
      "exec_World",
      "m2_after_hello",
      "m1_after_hello",
    ]);
  });

  test("Middleware สามารถแก้ไข input ใน context ได้ (Sanitization)", async () => {
    const gateway = createToolGateway();

    // Middleware ทำความสะอาด input
    gateway.use(async (ctx, next) => {
      if (typeof ctx.input === "string") {
        ctx.input = ctx.input.trim().toUpperCase();
      }
      return next();
    });

    gateway.register({
      name: "echo",
      execute: (text: string) => text,
    });

    const res = await gateway.execute("echo", "   clean me up   ");
    expect(res).toBe("CLEAN ME UP");
  });

  test("Middleware สามารถทำ Guardrails เพื่อระงับคำสั่ง (Short-circuit)", async () => {
    const gateway = createToolGateway();

    // Guardrail: บล็อก tool ต้องห้าม
    gateway.use(async (ctx, next) => {
      if (ctx.name === "dangerous_tool") {
        throw new Error("Access denied: Dangerous tool blocked by guardrails");
      }
      return next();
    });

    gateway.register({
      name: "dangerous_tool",
      execute: () => "dropped table",
    });

    expect(gateway.execute("dangerous_tool", {})).rejects.toThrow(
      "Access denied: Dangerous tool blocked by guardrails",
    );
  });

  test("Middleware สามารถดักจับและจัดการ Error ได้ (Error Recovery)", async () => {
    const gateway = createToolGateway();

    // Catch-all error recovery middleware
    gateway.use(async (_ctx, next) => {
      try {
        return await next();
      } catch (err) {
        return {
          ok: false,
          error: (err as Error).message,
        };
      }
    });

    gateway.register({
      name: "fail",
      execute: () => {
        throw new Error("Database timeout");
      },
    });

    const res = await gateway.execute("fail", {});
    expect(res).toEqual({
      ok: false,
      error: "Database timeout",
    });
  });

  test("Middleware ทำงานร่วมกับ Batch Execution และ Adapters ได้", async () => {
    const gateway = createToolGateway();
    const callsLog: string[] = [];

    gateway.use(async (ctx, next) => {
      callsLog.push(ctx.name);
      return next();
    });

    gateway
      .register({
        name: "math_add",
        execute: (x: number) => x + 1,
      })
      .register({
        name: "math_sub",
        execute: (x: number) => x - 1,
      });

    // ทดสอบผ่าน executeOpenAIToolCalls
    const openAICalls = [
      {
        id: "c1",
        type: "function" as const,
        function: { name: "math_add", arguments: "10" },
      },
      {
        id: "c2",
        type: "function" as const,
        function: { name: "math_sub", arguments: "10" },
      },
    ];

    const results = await executeOpenAIToolCalls(gateway, openAICalls);

    expect(results).toHaveLength(2);
    expect(callsLog).toEqual(["math_add", "math_sub"]);
  });
});
