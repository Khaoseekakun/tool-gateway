import { describe, expect, test } from "bun:test";
import { createToolGateway } from "../src";

describe("ToolGateway", () => {
  test("register and execute tool", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "add",
      description: "add (test)",
      execute(input: { a: number; b: number }) {
        return input.a + input.b;
      },
    });

    const result = await gateway.execute<number>("add", {
      a: 10,
      b: 20,
    });

    expect(result).toBe(30);
  });

  test("executeMany สามารถรันหลาย tools พร้อมกันได้", async () => {
    const gateway = createToolGateway();

    gateway
      .register({
        name: "double",
        description: "double (test)",
        execute: (x: number) => x * 2,
      })
      .register({
        name: "square",
        description: "square (test)",
        execute: (x: number) => x * x,
      });

    const results = await gateway.executeMany([
      { name: "double", input: 5 },
      { name: "square", input: 4 },
      { name: "double", input: 10 },
    ]);

    expect(results).toEqual([10, 16, 20]);
  });
});