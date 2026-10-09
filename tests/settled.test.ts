import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  executeOpenAIToolCallsSettled,
  executeAnthropicToolUsesSettled,
  executeGeminiFunctionCallsSettled,
  executeCohereToolCallsSettled,
  executeCohereV2ToolCallsSettled,
} from "../src";

function makeGateway() {
  const gateway = createToolGateway();
  gateway.register({
    name: "ok",
    description: "ok (test)",
    execute: (input: { v: number }) => ({ doubled: input.v * 2 }),
  });
  gateway.register({
    name: "boom",
    description: "boom (test)",
    execute: () => {
      throw new Error("kaboom");
    },
  });
  return gateway;
}

describe("gateway.executeManySettled", () => {
  test("mix of success + failure does not reject; reasons preserved", async () => {
    const gateway = makeGateway();
    const results = await gateway.executeManySettled([
      { name: "ok", input: { v: 2 } },
      { name: "boom", input: {} },
      { name: "ok", input: { v: 5 } },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: "fulfilled", value: { doubled: 4 } });
    expect(results[1].status).toBe("rejected");
    expect((results[1] as { reason: Error }).reason.message).toBe("kaboom");
    expect(results[2]).toEqual({ status: "fulfilled", value: { doubled: 10 } });
  });

  test("unknown tool is a rejected entry, not a batch rejection", async () => {
    const gateway = makeGateway();
    const results = await gateway.executeManySettled([
      { name: "does_not_exist", input: {} },
    ]);
    expect(results[0].status).toBe("rejected");
  });
});

describe("OpenAI settled", () => {
  test("failing call yields { output: null, error }, others succeed", async () => {
    const gateway = makeGateway();
    const results = await executeOpenAIToolCallsSettled(gateway, [
      {
        id: "c1",
        type: "function",
        function: { name: "ok", arguments: '{"v":1}' },
      },
      {
        id: "c2",
        type: "function",
        function: { name: "boom", arguments: "{}" },
      },
    ]);

    expect(results[0]).toEqual({
      tool_call_id: "c1",
      content: '{"doubled":2}',
      output: { doubled: 2 },
    });
    expect(results[1]).toEqual({
      tool_call_id: "c2",
      content: '{"error":"kaboom"}',
      output: null,
      error: "kaboom",
    });
  });
});

describe("Anthropic settled", () => {
  test("failing use yields tool_result with { error } content", async () => {
    const gateway = makeGateway();
    const results = await executeAnthropicToolUsesSettled(gateway, [
      { type: "tool_use", id: "u1", name: "boom", input: {} },
    ]);

    expect(results[0]).toEqual({
      type: "tool_result",
      tool_use_id: "u1",
      content: JSON.stringify({ error: "kaboom" }),
    });
  });
});

describe("Gemini settled", () => {
  test("failing call yields functionResponse with { error } response", async () => {
    const gateway = makeGateway();
    const results = await executeGeminiFunctionCallsSettled(gateway, [
      { name: "boom", args: {} },
    ]);

    expect(results[0]).toEqual({
      functionResponse: { name: "boom", response: { error: "kaboom" } },
    });
  });
});

describe("Cohere v1 settled", () => {
  test("failing call yields outputs: [{ error }]", async () => {
    const gateway = makeGateway();
    const results = await executeCohereToolCallsSettled(gateway, [
      { name: "boom", parameters: {} },
    ]);

    expect(results[0]).toEqual({
      call: { name: "boom", parameters: {} },
      outputs: [{ error: "kaboom" }],
    });
  });
});

describe("Cohere v2 settled", () => {
  test("failing call yields document data { error }", async () => {
    const gateway = makeGateway();
    const results = await executeCohereV2ToolCallsSettled(gateway, [
      {
        id: "c1",
        type: "function",
        function: { name: "boom", arguments: "{}" },
      },
    ]);

    expect(results[0]).toEqual({
      tool_call_id: "c1",
      content: [{ type: "document", document: { data: '{"error":"kaboom"}' } }],
    });
  });
});
