/**
 * Tool Gateway — Live Execution Flow demo.
 *
 * Everything below runs the REAL @fourbits-studio/tool-gateway bundle
 * (./lib/tool-gateway.js) in the browser. The animation only staggers
 * when each step is *revealed* — the calls themselves are genuine.
 */
import {
  createToolGateway,
  toTools,
  detectProvider,
  runToolCalls,
} from "./lib/tool-gateway.js";

// ── tiny DOM helpers ──────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const pipelineEl = $("#pipeline");
const consoleEl = $("#console");
const runBtn = $("#run");
const resetBtn = $("#reset");
const speedEl = $("#speed");
const t0 = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function pretty(v) {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

// ── event log ─────────────────────────────────────────────────────────────
function log(source, message, cls = "") {
  const t = (Date.now() - t0) / 1000;
  const line = document.createElement("span");
  line.innerHTML =
    `<span class="log-t">${t.toFixed(3).padStart(7)}</span> │ ` +
    `<span class="log-src ${cls}">${esc(source.padEnd(10))}</span> │ ${esc(message)}`;
  consoleEl.appendChild(line);
  consoleEl.appendChild(document.createTextNode("\n"));
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ── simulated model (no API key needed) ──────────────────────────────────
const PROVIDERS = [
  { id: "openai", label: "OpenAI / compatible", toolKey: "openai" },
  { id: "anthropic", label: "Anthropic", toolKey: "anthropic" },
  { id: "gemini", label: "Gemini", toolKey: "gemini" },
  { id: "cohere-v1", label: "Cohere v1", toolKey: "cohere" },
];

let currentProvider = "openai";

/** Build simulated tool calls in the selected provider's wire format. */
function simulateModelCalls(provider, scenarios) {
  const mk = (i, name, args, id) => ({
    name,
    args,
    id: id || `call_${i}`,
  });

  const picks = [];
  let n = 0;
  if (scenarios.ok) picks.push(mk(++n, "get_weather", { city: "Bangkok" }, `call_${n}`));
  if (scenarios.bad) picks.push(mk(++n, "get_weather", { city: 12345 }, `call_${n}`));
  if (scenarios.slow)
    picks.push(
      mk(++n, "query_db", { sql: "SELECT count(*) FROM orders" }, `call_${n}`),
    );
  if (scenarios.boom)
    picks.push(
      mk(++n, "send_report", { to: "ops@company.dev", body: "daily report" }, `call_${n}`),
    );

  switch (provider) {
    case "openai":
      return picks.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      }));
    case "anthropic":
      return picks.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: c.args,
      }));
    case "gemini":
      return picks.map((c) => ({ name: c.name, args: c.args }));
    case "cohere-v1":
      return picks.map((c) => ({ name: c.name, parameters: c.args }));
  }
}

/** What the model message "looks like" for the diagram step. */
function modelMessageView(provider, calls) {
  switch (provider) {
    case "openai":
      return { role: "assistant", tool_calls: calls };
    case "anthropic":
      return { role: "assistant", content: calls };
    case "gemini":
      return {
        role: "model",
        parts: calls.map((c) => ({ functionCall: c })),
      };
    case "cohere-v1":
      return {
        id: "sim-1",
        text: "",
        finish_reason: "COMPLETE",
        generations: [
          {
            id: "gen-1",
            text: "",
            finish_reason: "COMPLETE",
            message: { role: "TOOL_CALL", tool_calls: calls },
          },
        ],
      };
  }
}

// ── step scaffolding ──────────────────────────────────────────────────────
const stepDefs = [
  {
    id: "create",
    title: "createToolGateway",
    desc: "สร้าง gateway ตัวกลาง — กำหนด defaultTimeout ให้ทุก tool (tool ไหนต้องการ timeout แยกก็ตั้งเองได้)",
    code: `const gateway = createToolGateway({ defaultTimeout: 250 });`,
  },
  {
    id: "register",
    title: "gateway.register(…)",
    desc: "define tool เดียว — ทุก provider ใช้ tool set เดียวกันนี้ (ชื่อ + description + JSON Schema + execute)",
  },
  {
    id: "middleware",
    title: "gateway.use(…)",
    desc: "middleware แบบ onion (เหมือน Koa/Hono) — รอบนอกสุดเห็นทุก call: logging, guardrails, error recovery",
    code: `gateway.use(async (ctx, next) => {
  log("middleware", \`\${ctx.name} →\`);
  const start = performance.now();
  const result = await next();
  log("middleware", \`\${ctx.name} ← \${(performance.now()-start).toFixed(1)}ms\`);
  return result;
});`,
  },
  {
    id: "export",
    title: "toTools(gateway, provider)",
    desc: "export schema ออกเป็น format ของ provider ที่เลือก — เรียกฟังก์ชันเดียว เลือก format ได้",
  },
  {
    id: "model",
    title: "Model responds (simulated)",
    desc: "จำลองคำตอบของ model — คืน tool_calls ตาม wire format ของ provider นั้น (ไม่มี API key ก็รันได้)",
  },
  {
    id: "detect",
    title: "detectProvider(calls[0])",
    desc: "runToolCalls ตรวจรูปทรงของ call แล้วเลือก executor ของ provider นั้นให้อัตโนมัติ — ไม่ต้องบอกเอง",
  },
  {
    id: "run",
    title: "runToolCalls(gateway, calls)",
    desc: "รันทั้งหมดพร้อมกัน (Promise.all) — fail-soft: call ไหนพังไม่กระทบ call อื่น ผลลัพธ์คืนเป็น format ของ provider นั้นพร้อมส่งกลับ model",
  },
  {
    id: "back",
    title: "Append results → model",
    desc: "ผลลัพธ์ทุก call (ทั้ง success และ error) ส่งกลับ model ได้ทันที — model อ่าน error แล้ว retry ด้วย input ที่ถูก",
  },
];

function buildSteps() {
  pipelineEl.innerHTML = "";
  stepDefs.forEach((def, i) => {
    const el = document.createElement("article");
    el.className = "step";
    el.id = `step-${def.id}`;
    el.innerHTML = `
      <div class="step-head">
        <span class="step-num">STEP ${i + 1}</span>
        <span class="step-title">${esc(def.title)}</span>
        <span class="status">pending</span>
      </div>
      <p class="desc">${esc(def.desc)}</p>
      <pre class="code">${def.code ? esc(def.code) : ""}</pre>
      <pre class="payload"></pre>`;
    pipelineEl.appendChild(el);
  });
}

function setStep(id, state, payload) {
  const el = $(`#step-${id}`);
  el.classList.remove("active", "done", "error");
  const status = el.querySelector(".status");
  if (state === "active") {
    el.classList.add("active");
    status.className = "status running";
    status.textContent = "running…";
  } else if (state === "done") {
    el.classList.add("done");
    status.className = "status ok";
    status.textContent = payload?.ms != null ? `done · ${payload.ms.toFixed(1)}ms` : "done";
  } else if (state === "error") {
    el.classList.add("error");
    status.className = "status fail";
    status.textContent = "failed";
  }
  if (payload?.json !== undefined) {
    el.querySelector(".payload").textContent = pretty(payload.json);
    el.classList.add("open");
  }
}

// ── tools (the "business logic" side) ─────────────────────────────────────
function buildGateway(logFn) {
  const gateway = createToolGateway({ defaultTimeout: 250 });

  gateway.use(async (ctx, next) => {
    logFn("middleware", `${ctx.name} → before (input: ${JSON.stringify(ctx.input)})`);
    const start = performance.now();
    const result = await next();
    logFn(
      "middleware",
      `${ctx.name} ← after · ${(performance.now() - start).toFixed(1)}ms`,
      "ok",
    );
    return result;
  });

  gateway.register({
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
    execute: async (input) => {
      await sleep(15); // pretend it's an API
      return { city: input.city, temp: 31, condition: "Sunny" };
    },
  });

  gateway.register({
    name: "query_db",
    description: "Run a read-only SQL query",
    parameters: {
      type: "object",
      properties: { sql: { type: "string" } },
      required: ["sql"],
    },
    timeout: 250, // per-tool timeout — this query is "too slow"
    execute: async (input) => {
      await sleep(700); // simulates a slow aggregation
      return { rows: [{ count: 12345 }] };
    },
  });

  gateway.register({
    name: "send_report",
    description: "Send an email report",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        body: { type: "string" },
      },
      required: ["to"],
    },
    execute: async () => {
      throw new Error("SMTP server unreachable (simulated outage)");
    },
  });

  return gateway;
}

const TOOL_SUMMARY = [
  ["get_weather", "city: string (required)", "→ weather object", "fast"],
  ["query_db", "sql: string (required)", "→ rows · timeout 250ms", "slow (700ms)"],
  ["send_report", "to: string (required), body", "→ always throws", "fails"],
];

// ── classify a settled result into sub-step states ────────────────────────
function classify(provider, index, result) {
  // returns { validate, timeout, execute, resultText, isError }
  const getError = () => {
    switch (provider) {
      case "openai":
        return result.error;
      case "anthropic":
        try {
          const c = JSON.parse(result.content);
          return c.error;
        } catch {
          return undefined;
        }
      case "gemini":
        return result.functionResponse?.response?.error;
      case "cohere-v1":
        return result.outputs?.[0]?.error;
    }
  };
  const error = getError();

  if (!error) {
    return {
      validate: "ok",
      timeout: "ok",
      execute: "ok",
      resultText: "result  →  " + (provider === "gemini"
        ? JSON.stringify(result.functionResponse.response)
        : provider === "anthropic"
          ? result.content
          : provider === "cohere-v1"
            ? JSON.stringify(result.outputs)
            : result.content),
      isError: false,
    };
  }
  if (error.includes("Invalid input for tool")) {
    return {
      validate: "fail",
      timeout: "skip",
      execute: "skip",
      resultText: "validation error → " + error,
      isError: true,
    };
  }
  if (error.includes("timed out")) {
    return {
      validate: "ok",
      timeout: "fail",
      execute: "skip",
      resultText: "timeout error → " + error,
      isError: true,
    };
  }
  return {
    validate: "ok",
    timeout: "ok",
    execute: "fail",
    resultText: "tool error → " + error,
    isError: true,
  };
}

const subLabel = (key, st) => {
  const name =
    key === "validate" ? "validate schema" :
    key === "timeout" ? "timeout guard" :
    key === "execute" ? "execute" : "";
  const mark = st === "ok" ? "✓" : st === "fail" ? "✗" : "–";
  return `<span class="sub ${st}">${mark} ${name}</span>`;
};

// ── the run sequence ──────────────────────────────────────────────────────
let running = false;

async function run() {
  if (running) return;
  running = true;
  runBtn.disabled = true;
  consoleEl.innerHTML = "";
  buildSteps();

  const provider = currentProvider;
  const meta = PROVIDERS.find((p) => p.id === provider);
  const scenarios = [...document.querySelectorAll("[data-scenario]")].reduce(
    (acc, el) => ({ ...acc, [el.dataset.scenario]: el.checked }),
    {},
  );
  const stepDelay = Number(speedEl.value) || 500;
  const between = () => sleep(stepDelay);

  log("demo", `run start · provider=${provider} · scenarios=${Object.keys(scenarios).filter((k) => scenarios[k]).join(", ") || "(none)"}`);
  await between();

  // STEP 1 — create gateway
  setStep("create", "active");
  const gateway = buildGateway((src, msg, cls) => log(src, msg, cls));
  const t1 = performance.now();
  await between();
  setStep("create", "done", { ms: performance.now() - t1 });
  log("gateway", "created · defaultTimeout=250ms", "ok");
  await between();

  // STEP 2 — register
  setStep("register", "active");
  const regRows = TOOL_SUMMARY.map(
    (r) => `│ ${r[0].padEnd(13)} │ ${r[1].padEnd(28)} │ ${r[2].padEnd(22)} │ ${r[3]} │`,
  ).join("\n");
  setStep(
    "register",
    "done",
    {
      ms: 0.3,
      json:
        "name            │ parameters               │ returns              │ note\n" +
        "├──────────────────────────────────────────────────────────────────────────────\n" +
        regRows,
    },
  );
  gateway.getAll().forEach((t) => log("tool", `registered "${t.name}"`));
  await between();

  // STEP 3 — middleware
  setStep("middleware", "active");
  await between();
  setStep("middleware", "done", { ms: 0.2 });
  log("middleware", "pipeline ready: [log] → validate → timeout → execute");
  await between();

  // STEP 4 — export schemas
  setStep("export", "active");
  const t4 = performance.now();
  const tools = await toTools(gateway, meta.toolKey);
  const exportMs = performance.now() - t4;
  await between();
  const toolCount = Array.isArray(tools) ? tools.length : 1;
  setStep("export", "done", { ms: exportMs, json: tools });
  log(
    "schema",
    `exported ${toolCount} tool declaration(s) → format "${meta.toolKey}" (${exportMs.toFixed(2)}ms)`,
    "ok",
  );
  await between();

  // STEP 5 — simulated model calls
  setStep("model", "active");
  const calls = simulateModelCalls(provider, scenarios);
  await between();
  setStep("model", "done", { ms: 1.0, json: modelMessageView(provider, calls) });
  log("model", `(simulated) responded with ${calls.length} tool_call(s)`);
  if (calls.length === 0) {
    log("demo", "no scenarios selected — nothing to run", "err");
    setStep("detect", "error");
    setStep("run", "error");
    setStep("back", "error");
    running = false;
    runBtn.disabled = false;
    return;
  }
  await between();

  // STEP 6 — detect
  setStep("detect", "active");
  const detected = detectProvider(calls[0]);
  await between();
  setStep("detect", "done", {
    ms: 0.1,
    json: { detected: detected, expected: provider, note: detected === provider ? "match ✔" : "NOTE: Cohere-v2 is wire-identical to OpenAI — pass { provider: \"cohere-v2\" } to get document-block results" },
  });
  log("detect", `provider detected: "${detected}"`, "ok");
  await between();

  // STEP 7 — run
  setStep("run", "active");
  const t7 = performance.now();
  const results = await runToolCalls(gateway, calls);
  const runMs = performance.now() - t7;

  const runStep = $("#step-run");
  calls.forEach((c, i) => {
    const result = results[i];
    const cls = classify(provider, i, result);
    const idLabel =
      provider === "anthropic" ? result.tool_use_id
      : provider === "openai" ? result.tool_call_id
      : c.name;
    const inputView =
      provider === "openai"
        ? c.function.arguments
        : provider === "anthropic"
          ? JSON.stringify(c.input)
          : provider === "gemini"
            ? JSON.stringify(c.args)
            : JSON.stringify(c.parameters);

    const callEl = document.createElement("div");
    callEl.className = "call";
    callEl.innerHTML = `
      <div class="call-head">
        <span class="cid">${esc(idLabel)}</span>
        <span class="cname">${esc(c.name)}</span>
        <span class="cinput">${esc(inputView)}</span>
      </div>
      <div class="substeps">
        <span class="sub ok">✓ middleware (log)</span>
        ${subLabel("validate", cls.validate)}
        ${subLabel("timeout", cls.timeout)}
        ${subLabel("execute", cls.execute)}
        <span class="sub ${cls.isError ? "skip" : "ok"}">${cls.isError ? "– batch continues" : "✓ done"}</span>
      </div>
      <div class="call-result ${cls.isError ? "err" : "ok"}">
        <span class="tag">→ ${cls.isError ? "per-call error (fail-soft — model reads this & retries)" : "result (provider native format)"}</span>
        ${esc(cls.resultText)}
      </div>`;
    runStep.appendChild(callEl);

    const src = cls.isError ? "result" : "result";
    log(src, `${c.name} [${idLabel}] ${cls.isError ? "FAILED → " + cls.resultText : "OK"}`, cls.isError ? "err" : "ok");
  });

  setStep("run", "done", { ms: runMs, json: { summary: `${calls.length} call(s) in parallel · ${runMs.toFixed(1)}ms total · failures returned per-call, batch did not reject` } });
  log("run", `runToolCalls finished: ${calls.length} call(s) in ${runMs.toFixed(1)}ms (fail-soft)`, "ok");
  await between();

  // STEP 8 — back to model
  setStep("back", "active");
  const backView =
    provider === "openai"
      ? results.map((r) => ({ role: "tool", tool_call_id: r.tool_call_id, content: r.content }))
      : provider === "anthropic"
        ? results
        : provider === "gemini"
          ? { parts: results.map((r) => ({ functionResponse: r.functionResponse })) }
          : results;
  await between();
  setStep("back", "done", { ms: 0.1, json: backView });
  log("demo", "flow complete — results ready to append to the conversation", "ok");

  running = false;
  runBtn.disabled = false;
}

// ── UI wiring ─────────────────────────────────────────────────────────────
const tabsEl = $("#provider-tabs");
PROVIDERS.forEach((p) => {
  const btn = document.createElement("button");
  btn.className = "tab";
  btn.textContent = p.label;
  btn.setAttribute("aria-pressed", String(p.id === currentProvider));
  btn.addEventListener("click", () => {
    currentProvider = p.id;
    tabsEl
      .querySelectorAll(".tab")
      .forEach((b) => b.setAttribute("aria-pressed", "false"));
    btn.setAttribute("aria-pressed", "true");
  });
  tabsEl.appendChild(btn);
});

runBtn.addEventListener("click", run);
resetBtn.addEventListener("click", () => {
  if (running) return;
  buildSteps();
  consoleEl.innerHTML = "";
  log("demo", "reset — press ▶ Run flow");
});

window.addEventListener("load", () => {
  if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: true, theme: "dark", securityLevel: "loose" });
  }
  buildSteps();
  log("demo", "ready — pick a provider & scenarios, then ▶ Run flow");
});
