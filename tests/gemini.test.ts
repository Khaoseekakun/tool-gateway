import { describe, expect, test } from "bun:test";
import {
  createToolGateway,
  toGeminiTool,
  toGeminiFunctionDeclarations,
  executeGeminiFunctionCall,
  executeGeminiFunctionCalls,
} from "../src";

describe("Google Gemini Adapter", () => {
  test("แปลง tools เป็น Gemini Tool และ FunctionDeclaration ได้ถูกต้อง", () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "fetch_stock_price",
      description: "ดึงราคาหุ้นตาม ticker symbol",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
        },
        required: ["ticker"],
      },
      execute: (input: { ticker: string }) => ({
        ticker: input.ticker,
        price: 150.25,
      }),
    });

    const geminiTool = toGeminiTool(gateway);
    expect(geminiTool.functionDeclarations).toHaveLength(1);
    expect(geminiTool.functionDeclarations[0]).toEqual({
      name: "fetch_stock_price",
      description: "ดึงราคาหุ้นตาม ticker symbol",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
        },
        required: ["ticker"],
      },
    });

    const declarations = toGeminiFunctionDeclarations(gateway);
    expect(declarations).toEqual(geminiTool.functionDeclarations);
  });

  test("executeGeminiFunctionCall คืนค่าในรูปแบบ functionResponse part", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "multiply",
      execute: (input: { a: number; b: number }) => ({
        result: input.a * input.b,
      }),
    });

    const call = {
      name: "multiply",
      args: { a: 7, b: 8 },
    };

    const responsePart = await executeGeminiFunctionCall(gateway, call);

    expect(responsePart).toEqual({
      functionResponse: {
        name: "multiply",
        response: {
          result: 56,
        },
      },
    });
  });

  test("executeGeminiFunctionCall กรณี output เป็น primitive คืนค่าหุ้มด้วย object", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "ping",
      execute: () => "pong",
    });

    const responsePart = await executeGeminiFunctionCall(gateway, { name: "ping" });

    expect(responsePart).toEqual({
      functionResponse: {
        name: "ping",
        response: {
          result: "pong",
        },
      },
    });
  });

  test("executeGeminiFunctionCalls สามารถรันหลาย function calls พร้อมกันได้", async () => {
    const gateway = createToolGateway();

    gateway.register({
      name: "get_status",
      execute: (input: { service: string }) => ({
        service: input.service,
        status: "healthy",
      }),
    });

    const calls = [
      { name: "get_status", args: { service: "auth" } },
      { name: "get_status", args: { service: "database" } },
    ];

    const results = await executeGeminiFunctionCalls(gateway, calls);

    expect(results).toHaveLength(2);
    expect(results[0].functionResponse.response).toEqual({
      service: "auth",
      status: "healthy",
    });
    expect(results[1].functionResponse.response).toEqual({
      service: "database",
      status: "healthy",
    });
  });
});
