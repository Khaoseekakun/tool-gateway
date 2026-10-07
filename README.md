# 🌐 Tool Gateway

[![npm version](https://img.shields.io/npm/v/@fourbits-studio/tool-gateway.svg?color=blue)](https://www.npmjs.com/package/@fourbits-studio/tool-gateway)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://www.npmjs.com/package/@fourbits-studio/tool-gateway)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Define your AI tools once. Run them anywhere.**  
> A lightweight, type-safe, and universal AI Tool Gateway for TypeScript, Node.js, and Bun.

---

## 💡 Why Tool Gateway?

Each AI provider uses a completely different format for tool calling:
- **OpenAI** requires `parameters` (JSON Schema) and returns JSON strings in `tool_calls`.
- **Claude** requires `input_schema` and communicates via `tool_use` / `tool_result` blocks.
- **Gemini** expects `functionDeclarations` and responds with `functionResponse`.
- **Cohere** uses its own `parameter_definitions` structure.
- **Vercel AI SDK** expects a dictionary object (`Record<string, CoreTool>`).

**Tool Gateway bridges them all.** Write your tool logic once, and effortlessly plug it into any model with automatic schema conversion, argument parsing, lifecycle middleware, and parallel execution.

```
                  ┌───► OpenAI / Groq / Ollama / DeepSeek
                  ├───► Anthropic (Claude)
   ToolGateway ───┼───► Google Gemini
 (Single Source)  ├───► Cohere
                  └───► Vercel AI SDK (`ai`)
```

---

## ⚡ Highlights

- 🚀 **Zero Runtime Dependencies** – Microsecond execution overhead.
- 🛡️ **100% Type-Safe** – Full TypeScript generics and autocompletion.
- 🧅 **Onion-Style Middleware** – Built-in logging, latency tracking, guardrails, and error recovery.
- ⚡ **Parallel Execution** – First-class `Promise.all` support for batch tool calls across all providers.
- 🌐 **Cross-Runtime** – Works natively on Bun, Node.js (>=20), and Edge runtimes.

---

## 📦 Installation

```bash
# Bun
bun add @fourbits-studio/tool-gateway

# NPM
npm install @fourbits-studio/tool-gateway

# PNPM
pnpm add @fourbits-studio/tool-gateway
```

---

## 🚀 Quick Start (In 30 Seconds)

### 1. Define your Gateway and Tools

```typescript
import { createToolGateway } from "@fourbits-studio/tool-gateway";

export const gateway = createToolGateway();

gateway.register({
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
  },
  execute: ({ city }: { city: string }) => {
    return { city, temp: 30, condition: "Sunny" };
  },
});
```

---

## 🤖 Using with AI Providers

### 🌐 Vercel AI SDK (`ai`)
Pass your gateway tools directly into `generateText` or `streamText`:

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { toVercelTools } from "@fourbits-studio/tool-gateway";
import { gateway } from "./gateway";

const { text } = await generateText({
  model: openai("gpt-4o"),
  prompt: "What's the weather in Bangkok?",
  tools: toVercelTools(gateway), // That's it!
});
```

---

### 🟢 OpenAI & Compatible (Groq, Mistral, Ollama, DeepSeek)
Format tools for OpenAI and automatically parse arguments upon execution:

```typescript
import { toOpenAITools, executeOpenAIToolCalls } from "@fourbits-studio/tool-gateway";
import { gateway } from "./gateway";

// 1. Export schema to OpenAI API
const tools = toOpenAITools(gateway);

// 2. Execute parallel tool calls when model responds
const results = await executeOpenAIToolCalls(gateway, response.choices[0].message.tool_calls);
// Returns: [{ tool_call_id: "...", output: { ... } }, ...]
```

---

### 🟣 Anthropic (Claude)
Automatically maps `parameters` to Claude's `input_schema` and wraps results into `tool_result` blocks:

```typescript
import { toAnthropicTools, executeAnthropicToolUses } from "@fourbits-studio/tool-gateway";
import { gateway } from "./gateway";

// 1. Export tools for Claude API
const tools = toAnthropicTools(gateway);

// 2. Execute tool_use blocks returned by Claude
const results = await executeAnthropicToolUses(gateway, contentBlocks);
// Returns: [{ type: "tool_result", tool_use_id: "...", content: "{...}" }, ...]
```

---

### 🔵 Google Gemini
Formats tools into Gemini's `functionDeclarations` and wraps output into `functionResponse`:

```typescript
import { toGeminiTool, executeGeminiFunctionCalls } from "@fourbits-studio/tool-gateway";
import { gateway } from "./gateway";

// 1. Export tools to Gemini API
const geminiTools = [toGeminiTool(gateway)];

// 2. Execute function calls returned by Gemini
const responseParts = await executeGeminiFunctionCalls(gateway, functionCalls);
// Returns: [{ functionResponse: { name: "...", response: { ... } } }, ...]
```

---

### 🟠 Cohere
Transforms standard JSON Schema properties into Cohere's `parameter_definitions`:

```typescript
import { toCohereTools, executeCohereToolCalls } from "@fourbits-studio/tool-gateway";
import { gateway } from "./gateway";

const cohereTools = toCohereTools(gateway);
const results = await executeCohereToolCalls(gateway, cohereCalls);
```

---

## 🧅 Middleware Pipeline

Tool Gateway features an **Onion-Style Middleware** architecture (similar to Koa & Hono). Middlewares run for **both single and batch executions** across all providers.

```typescript
// 1. Logging & Latency Tracking
gateway.use(async (ctx, next) => {
  const start = performance.now();
  console.log(`[Tool Call] ${ctx.name}`, ctx.input);
  
  const result = await next();
  
  console.log(`[Tool Done] ${ctx.name} in ${(performance.now() - start).toFixed(2)}ms`);
  return result;
});

// 2. Guardrails (Short-circuit unauthorized commands)
gateway.use(async (ctx, next) => {
  if (ctx.name.startsWith("admin_")) {
    throw new Error("Access Denied: Admin tools cannot be invoked directly.");
  }
  return next();
});

// 3. Error Recovery (Prevent crashes)
gateway.use(async (_ctx, next) => {
  try {
    return await next();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});
```

---

## 📖 API Reference

### Core Gateway

| Method | Description |
| :--- | :--- |
| `createToolGateway()` | Factory function to instantiate a new `ToolGateway`. |
| `gateway.register(tool)` | Registers a new tool. Throws if the tool name already exists. |
| `gateway.use(middleware)` | Adds an onion-style middleware to the execution chain. |
| `gateway.execute(name, input)` | Executes a single tool through the middleware pipeline. |
| `gateway.executeMany(calls)` | Executes multiple tools concurrently using `Promise.all`. |
| `gateway.has(name)` | Checks if a tool with the given name is registered. |
| `gateway.get(name)` | Retrieves a tool definition by name. |
| `gateway.getAll()` | Returns an array of all registered tool definitions. |
| `gateway.list()` | Returns a summary list of all tools (`name`, `description`). |

---

### Adapters Reference

| Adapter | Schema Exporters | Execution Functions | Output Format |
| :--- | :--- | :--- | :--- |
| **Vercel AI SDK** | `toVercelTools(gateway)`<br>`toVercelTool(gateway, tool)` | Handled natively by Vercel `tool.execute()` | Standard Output |
| **OpenAI** | `toOpenAITools(gateway)`<br>`toOpenAITool(tool)` | `executeOpenAIToolCall(gw, call)`<br>`executeOpenAIToolCalls(gw, calls)` | `{ tool_call_id, output }` |
| **Anthropic** | `toAnthropicTools(gateway)`<br>`toAnthropicTool(tool)` | `executeAnthropicToolUse(gw, use)`<br>`executeAnthropicToolUses(gw, uses)` | `{ type: "tool_result", tool_use_id, content }` |
| **Google Gemini** | `toGeminiTool(gateway)`<br>`toGeminiFunctionDeclarations(gw)` | `executeGeminiFunctionCall(gw, call)`<br>`executeGeminiFunctionCalls(gw, calls)` | `{ functionResponse: { name, response } }` |
| **Cohere** | `toCohereTools(gateway)`<br>`toCohereTool(tool)` | `executeCohereToolCall(gw, call)`<br>`executeCohereToolCalls(gw, calls)` | `{ call, outputs: [...] }` |

---

## 📄 License

[MIT](LICENSE) © [Fourbits Studio](https://github.com/Fourbits-Studio)