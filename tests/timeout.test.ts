import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  ToolTimeoutError,
  executeOpenAIToolCallsSettled,
} from "../src";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Tool execution timeout", () => {
  test("defaultTimeout makes a slow tool reject with ToolTimeoutError", async () => {
    const gateway = createToolGateway({ defaultTimeout: 50 });
    gateway.register({
      name: "slow",
      description: "slow (test)",
      execute: async () => {
        await sleep(300);
        return "never";
      },
    });

    const started = Date.now();
    const promise = gateway.execute("slow", {});
    await expect(promise).rejects.toBeInstanceOf(ToolTimeoutError);
    await expect(promise).rejects.toThrow('Tool "slow" timed out after 50ms');
    expect(Date.now() - started).toBeLessThan(250);
  });

  test("per-tool timeout overrides the gateway default", async () => {
    const gateway = createToolGateway({ defaultTimeout: 500 });
    gateway.register({
      name: "fast_limit",
      description: "fast_limit (test)",
      timeout: 50,
      execute: async () => {
        await sleep(300);
        return "never";
      },
    });

    await expect(gateway.execute("fast_limit", {})).rejects.toThrow(
      'timed out after 50ms',
    );
  });

  test("a tool that finishes in time is not affected by the timeout", async () => {
    const gateway = createToolGateway({ defaultTimeout: 500 });
    gateway.register({
      name: "quick",
      description: "quick (test)",
      execute: async () => {
        await sleep(20);
        return "done";
      },
    });

    await expect(gateway.execute("quick", {})).resolves.toBe("done");
  });

  test("no timeout configured -> no limit applied", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "slow_ok",
      description: "slow_ok (test)",
      execute: async () => {
        await sleep(100);
        return "ok";
      },
    });

    await expect(gateway.execute("slow_ok", {})).resolves.toBe("ok");
  });

  test("timeout error can be caught by error-recovery middleware", async () => {
    const gateway = createToolGateway({ defaultTimeout: 30 });
    gateway.use(async (_ctx, next) => {
      try {
        return await next();
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });
    gateway.register({
      name: "slow",
      description: "slow (test)",
      execute: async () => {
        await sleep(300);
        return "never";
      },
    });

    await expect(gateway.execute("slow", {})).resolves.toEqual({
      ok: false,
      error: 'Tool "slow" timed out after 30ms',
    });
  });

  test("settled batch contains the timeout as a per-call error", async () => {
    const gateway = createToolGateway({ defaultTimeout: 30 });
    gateway.register({
      name: "ok",
      description: "ok (test)",
      execute: () => "fine",
    });
    gateway.register({
      name: "slow",
      description: "slow (test)",
      execute: async () => {
        await sleep(300);
        return "never";
      },
    });

    const results = await executeOpenAIToolCallsSettled(gateway, [
      { id: "c1", type: "function", function: { name: "ok", arguments: "{}" } },
      {
        id: "c2",
        type: "function",
        function: { name: "slow", arguments: "{}" },
      },
    ]);

    expect(results[0].output).toBe("fine");
    expect(results[1]).toEqual({
      tool_call_id: "c2",
      content: '{"error":"Tool \\"slow\\" timed out after 30ms"}',
      output: null,
      error: 'Tool "slow" timed out after 30ms',
    });
  });
});
