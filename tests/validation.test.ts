import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  ToolInputValidationError,
  validateToolInput,
} from "../src";

describe("validateToolInput (JSON Schema subset)", () => {
  test("no schema -> always valid", () => {
    expect(validateToolInput(undefined, { anything: 1 })).toEqual([]);
    expect(validateToolInput(null, "x")).toEqual([]);
  });

  test("valid object input passes", () => {
    const schema = {
      type: "object",
      properties: {
        city: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["city"],
    };
    expect(validateToolInput(schema, { city: "BKK", limit: 5 })).toEqual([]);
    expect(validateToolInput(schema, { city: "BKK" })).toEqual([]);
  });

  test("missing required property is reported with field name", () => {
    const schema = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };
    const errors = validateToolInput(schema, {});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('missing required property "city"');
  });

  test("wrong type is reported", () => {
    const schema = {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
    };
    const errors = validateToolInput(schema, { amount: "100" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("expected type number");
  });

  test("integer type rejects non-integers, number type accepts integers", () => {
    const intSchema = { type: "object", properties: { n: { type: "integer" } } };
    expect(validateToolInput(intSchema, { n: 3 })).toEqual([]);
    expect(validateToolInput(intSchema, { n: 3.5 })).toHaveLength(1);

    const numSchema = { type: "object", properties: { n: { type: "number" } } };
    expect(validateToolInput(numSchema, { n: 3 })).toEqual([]);
    expect(validateToolInput(numSchema, { n: 3.5 })).toEqual([]);
  });

  test("nested object + array items are validated with paths", () => {
    const schema = {
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: { tags: { type: "array", items: { type: "string" } } },
        },
      },
    };
    expect(validateToolInput(schema, { filter: { tags: ["a", "b"] } })).toEqual([]);
    const errors = validateToolInput(schema, { filter: { tags: ["a", 1] } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("filter.tags[1]");
  });

  test("enum is enforced", () => {
    const schema = {
      type: "object",
      properties: { unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    };
    expect(validateToolInput(schema, { unit: "celsius" })).toEqual([]);
    expect(validateToolInput(schema, { unit: "kelvin" })).toHaveLength(1);
  });

  test("additionalProperties:false rejects unknown keys", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    };
    expect(validateToolInput(schema, { a: "x" })).toEqual([]);
    expect(validateToolInput(schema, { a: "x", b: 1 })).toHaveLength(1);
    // By default (additionalProperties omitted) extra keys are allowed.
    expect(
      validateToolInput({ type: "object", properties: { a: { type: "string" } } }, {
        a: "x",
        b: 1,
      }),
    ).toEqual([]);
  });

  test("numeric + string constraints", () => {
    expect(
      validateToolInput(
        { type: "object", properties: { n: { type: "number", minimum: 0, maximum: 10 } } },
        { n: 5 },
      ),
    ).toEqual([]);
    expect(
      validateToolInput(
        { type: "object", properties: { n: { type: "number", minimum: 0 } } },
        { n: -1 },
      ),
    ).toHaveLength(1);

    expect(
      validateToolInput(
        { type: "object", properties: { s: { type: "string", minLength: 2 } } },
        { s: "a" },
      ),
    ).toHaveLength(1);
    expect(
      validateToolInput(
        { type: "object", properties: { s: { type: "string", pattern: "^[a-z]+$" } } },
        { s: "ABC" },
      ),
    ).toHaveLength(1);
  });

  test("type arrays (union types) are supported", () => {
    const schema = {
      type: "object",
      properties: { v: { type: ["string", "null"] } },
    };
    expect(validateToolInput(schema, { v: "x" })).toEqual([]);
    expect(validateToolInput(schema, { v: null })).toEqual([]);
    expect(validateToolInput(schema, { v: 1 })).toHaveLength(1);
  });
});

describe("Gateway input validation integration", () => {
  test("execute throws ToolInputValidationError for invalid input", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "get_weather",
      description: "get_weather (test)",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      execute: (input: { city: string }) => input.city,
    });

    const promise = gateway.execute("get_weather", { city: 123 });
    await expect(promise).rejects.toBeInstanceOf(ToolInputValidationError);
    await expect(promise).rejects.toThrow('expected type string');
  });

  test("valid input still executes normally", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "get_weather",
      description: "get_weather (test)",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      execute: (input: { city: string }) => `weather in ${input.city}`,
    });

    await expect(gateway.execute("get_weather", { city: "BKK" })).resolves.toBe(
      "weather in BKK",
    );
  });

  test("tool without parameters schema is not validated", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "raw",
      description: "raw (test)",
      execute: (input: unknown) => input,
    });
    await expect(gateway.execute("raw", { whatever: true })).resolves.toEqual({
      whatever: true,
    });
  });

  test("error-recovery middleware can intercept the validation error", async () => {
    const gateway = createToolGateway();
    gateway.use(async (_ctx, next) => {
      try {
        return await next();
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });
    gateway.register({
      name: "get_weather",
      description: "get_weather (test)",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      execute: (input: { city: string }) => input.city,
    });

    const result = await gateway.execute("get_weather", {});
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('missing required property "city"'),
    });
  });

  test("executeMany propagates validation errors", async () => {
    const gateway = createToolGateway();
    gateway.register({
      name: "add",
      description: "add (test)",
      parameters: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
      execute: (input: { a: number; b: number }) => input.a + input.b,
    });

    await expect(
      gateway.executeMany([{ name: "add", input: { a: 1, b: "2" } }]),
    ).rejects.toBeInstanceOf(ToolInputValidationError);
  });
});
