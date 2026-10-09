/**
 * Example 1: The complete agent loop — one function per side.
 *
 * This is the whole workflow:
 *   gateway ──toTools()──► model ──tool_calls──► runToolCalls() ──► back to model
 *
 * It uses a SIMULATED model so you can run it without any API key:
 *   bun run examples/agent-loop.ts
 *   (or: npx tsx examples/agent-loop.ts)
 */
import {
  createToolGateway,
  toTools,
  runToolCalls,
} from "../src/index";

// ── 1. Define the gateway once ────────────────────────────────────────────
const gateway = createToolGateway({ defaultTimeout: 5000 });

// A single source of truth — the same tool works with every provider.
gateway.register({
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, e.g. Bangkok" },
    },
    required: ["city"],
  },
  execute: (input: { city: string }) => ({
    city: input.city,
    temp: 31,
    condition: "Sunny",
  }),
});

gateway.register({
  name: "search_docs",
  description: "Search internal documentation",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      top_k: { type: "integer" },
    },
    required: ["query"],
  },
  execute: (input: { query: string; top_k?: number }) =>
    Array.from({ length: input.top_k ?? 3 }, (_, i) => ({
      title: `Doc ${i + 1} about ${input.query}`,
      snippet: "…",
    })),
});

// ── 2. Export the schemas in your provider's format ───────────────────────
// Use the matching format for whichever model you call:
const forOpenAI = await toTools(gateway, "openai"); // Groq/Ollama/DeepSeek too
const forAnthropic = await toTools(gateway, "anthropic");
const forGemini = await toTools(gateway, "gemini");
const forCohereV2 = await toTools(gateway, "cohere-v2");

console.log("── OpenAI tools ────────────────────────────────");
console.log(JSON.stringify(forOpenAI, null, 2));

// In a real app you would send `forOpenAI` as `tools:` in the chat request:
// const res = await openai.chat.completions.create({
//   model: "gpt-4o",
//   messages,
//   tools: forOpenAI,
// });

// ── 3. Simulate the model answering with tool calls ───────────────────────
// This is exactly the shape OpenAI returns in `message.tool_calls`
// (and Cohere v2 returns the same wire format).
const modelToolCalls = [
  {
    id: "call_1",
    type: "function",
    function: {
      name: "get_weather",
      arguments: JSON.stringify({ city: "Bangkok" }),
    },
  },
  {
    id: "call_2",
    type: "function",
    function: {
      name: "search_docs",
      arguments: JSON.stringify({ query: "refund policy", top_k: 2 }),
    },
  },
];

// ── 4. ONE function runs them — provider detected automatically ──────────
const results = await runToolCalls(gateway, modelToolCalls);

console.log("\n── Results (OpenAI format, ready for role:tool messages) ──");
for (const r of results as Array<{
  tool_call_id: string;
  content: string;
  output: unknown;
  error?: string;
}>) {
  console.log(`[${r.tool_call_id}]`, r.error ?? r.content);
}

// ── 5. Send the results back to the model ─────────────────────────────────
// Each result's `content` string is exactly what a `role: "tool"` message
// needs — including per-call errors (fail-soft), which let the model retry.
const toolMessages = (results as Array<{ tool_call_id: string; content: string }>).map(
  (r) => ({ role: "tool", tool_call_id: r.tool_call_id, content: r.content }),
);
console.log("\n── Append to the conversation ──");
console.log(JSON.stringify(toolMessages, null, 2));

// ── Bonus: the same calls, other providers, still one function ────────────
const anthropicCalls = [
  { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "BKK" } },
];
console.log("\n── Anthropic result (tool_result block) ──");
console.log(
  JSON.stringify(await runToolCalls(gateway, anthropicCalls), null, 2),
);

const geminiCalls = [{ name: "get_weather", args: { city: "BKK" } }];
console.log("\n── Gemini result (functionResponse part) ──");
console.log(JSON.stringify(await runToolCalls(gateway, geminiCalls), null, 2));
