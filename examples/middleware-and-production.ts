/**
 * Example 2: Production patterns — logging, guardrails, error recovery,
 * timeouts, and fail-soft batch execution.
 *
 * Run: bun run examples/middleware-and-production.ts
 * (or: npx tsx examples/middleware-and-production.ts)
 */
import {
  createToolGateway,
  runToolCalls,
  ToolInputValidationError,
  ToolTimeoutError,
} from "../src/index";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gateway = createToolGateway({ defaultTimeout: 1000 });

// ── 1. Logging & latency tracking (outermost — sees everything) ──────────
gateway.use(async (ctx, next) => {
  const start = performance.now();
  console.log(`→ ${ctx.name}`, JSON.stringify(ctx.input));
  try {
    const result = await next();
    console.log(`← ${ctx.name} ok in ${(performance.now() - start).toFixed(1)}ms`);
    return result;
  } catch (error) {
    console.log(`✗ ${ctx.name} failed in ${(performance.now() - start).toFixed(1)}ms: ${(error as Error).message}`);
    throw error;
  }
});

// ── 2. Guardrails — block dangerous tools for this "user" ────────────────
gateway.use(async (ctx, next) => {
  const caller = "anonymous";
  if (ctx.name.startsWith("admin_") && caller !== "root") {
    throw new Error(`Access denied: "${ctx.name}" requires elevated privileges`);
  }
  return next();
});

// ── 3. Error recovery — convert crashes into model-readable results ──────
// (Optional: use this, OR rely on the fail-soft *Settled executors instead.)
// gateway.use(async (_ctx, next) => {
//   try {
//     return await next();
//   } catch (error) {
//     return { ok: false, error: (error as Error).message };
//   }
// });

// ── Register tools with per-tool timeouts ─────────────────────────────────
gateway.register({
  name: "fetch_profile",
  description: "Fetch a user profile by id",
  parameters: {
    type: "object",
    properties: { id: { type: "integer" } },
    required: ["id"],
  },
  execute: async (input: { id: number }) => {
    await sleep(30); // simulate API latency
    return { id: input.id, name: "User " + input.id, plan: "pro" };
  },
});

gateway.register({
  name: "report_analytics",
  description: "Aggregate analytics (slow query)",
  timeout: 150, // per-tool timeout, overrides the 1000ms default
  execute: async () => {
    await sleep(500); // simulates a slow aggregation
    return { rows: 12345 };
  },
});

gateway.register({
  name: "admin_purge_cache",
  description: "Purge the global cache (admin only)",
  execute: () => "purged",
});

// Simulate a model batch that exercises every path at once:
const calls = [
  // 1. Happy path
  { id: "c1", type: "function", function: { name: "fetch_profile", arguments: '{"id":42}' } },
  // 2. Model hallucinated a string where an integer was required
  { id: "c2", type: "function", function: { name: "fetch_profile", arguments: '{"id":"42"}' } },
  // 3. Slow tool → ToolTimeoutError (150ms limit)
  { id: "c3", type: "function", function: { name: "report_analytics", arguments: '{}' } },
  // 4. Guardrail blocks the admin tool
  { id: "c4", type: "function", function: { name: "admin_purge_cache", arguments: '{}' } },
  // 5. Unknown tool name
  { id: "c5", type: "function", function: { name: "does_not_exist", arguments: '{}' } },
] as const;

console.log("Running mixed batch (fail-soft — nothing rejects the whole batch):\n");

// The fail-soft executor: every failure becomes a per-call result the model can read.
const results = await runToolCalls(gateway, [...calls]);

console.log("\n── Per-call results ──");
for (const r of results as Array<{
  tool_call_id: string;
  output: unknown;
  error?: string;
}>) {
  console.log(
    `${r.tool_call_id}: ${r.error ? `ERROR → ${r.error}` : `OK → ${JSON.stringify(r.output)}`}`,
  );
}

// ── Typed error handling when you do want to react to specific failures ──
try {
  await gateway.execute("fetch_profile", { id: "nope" });
} catch (error) {
  if (error instanceof ToolInputValidationError) {
    console.log(`\nTyped validation error: fields=[${error.fields.join(", ")}]`);
  }
}
try {
  await gateway.execute("report_analytics", {});
} catch (error) {
  if (error instanceof ToolTimeoutError) {
    console.log(`Typed timeout error: after ${error.timeoutMs}ms`);
  }
}
