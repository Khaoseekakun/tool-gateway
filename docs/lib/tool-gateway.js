// src/validation.ts
var ToolInputValidationError = class extends Error {
  toolName;
  fields;
  constructor(toolName, fields) {
    super(
      `Invalid input for tool "${toolName}": ` + fields.map((f) => f === "" ? "(root)" : f).join("; ")
    );
    this.name = "ToolInputValidationError";
    this.toolName = toolName;
    this.fields = fields;
  }
};
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}
function matchesType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
function validateNode(schema, value, path, errors) {
  if (!isObject(schema)) return;
  const type = schema.type;
  if (typeof type === "string") {
    if (!matchesType(value, type)) {
      errors.push(
        `${path || "(root)"}: expected type ${type}, got ${describeValue(value)}`
      );
      return;
    }
  } else if (Array.isArray(type) && type.length > 0) {
    if (!type.some((t) => matchesType(value, String(t)))) {
      errors.push(
        `${path || "(root)"}: expected type [${type.join(", ")}], got ${describeValue(value)}`
      );
      return;
    }
  }
  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum;
    if (!allowed.some((option) => deepEqual(value, option))) {
      errors.push(
        `${path || "(root)"}: value ${JSON.stringify(value)} is not one of [${allowed.map((o) => JSON.stringify(o)).join(", ")}]`
      );
    }
  }
  if (typeof value === "string") {
    const minLen = schema.minLength;
    if (typeof minLen === "number" && value.length < minLen) {
      errors.push(`${path}: length ${value.length} is less than minLength ${minLen}`);
    }
    const maxLen = schema.maxLength;
    if (typeof maxLen === "number" && value.length > maxLen) {
      errors.push(`${path}: length ${value.length} is greater than maxLength ${maxLen}`);
    }
    const pattern = schema.pattern;
    if (typeof pattern === "string") {
      try {
        if (!new RegExp(pattern).test(value)) {
          errors.push(`${path}: value does not match pattern "${pattern}"`);
        }
      } catch {
      }
    }
  }
  if (typeof value === "number") {
    const minimum = schema.minimum;
    if (typeof minimum === "number" && value < minimum) {
      errors.push(`${path}: value ${value} is less than minimum ${minimum}`);
    }
    const maximum = schema.maximum;
    if (typeof maximum === "number" && value > maximum) {
      errors.push(`${path}: value ${value} is greater than maximum ${maximum}`);
    }
  }
  if (isObject(value)) {
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }
    const properties = schema.properties;
    if (isObject(properties)) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in value) {
          validateNode(
            propSchema,
            value[key],
            path ? `${path}.${key}` : key,
            errors
          );
        }
      }
    }
    const additional = schema.additionalProperties;
    if (additional === false && isObject(properties)) {
      const known = new Set(Object.keys(properties));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) {
          errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }
    const minProps = schema.minProperties;
    if (typeof minProps === "number" && Object.keys(value).length < minProps) {
      errors.push(`${path}: has fewer than ${minProps} properties`);
    }
    const maxProps = schema.maxProperties;
    if (typeof maxProps === "number" && Object.keys(value).length > maxProps) {
      errors.push(`${path}: has more than ${maxProps} properties`);
    }
  }
  if (Array.isArray(value)) {
    const items = schema.items;
    if (isObject(items)) {
      value.forEach((item, i) => {
        validateNode(items, item, `${path}[${i}]`, errors);
      });
    }
    const minItems = schema.minItems;
    if (typeof minItems === "number" && value.length < minItems) {
      errors.push(`${path}: has fewer than ${minItems} items`);
    }
    const maxItems = schema.maxItems;
    if (typeof maxItems === "number" && value.length > maxItems) {
      errors.push(`${path}: has more than ${maxItems} items`);
    }
  }
}
function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function validateToolInput(parameters, input) {
  if (!isObject(parameters)) return [];
  const errors = [];
  validateNode(parameters, input, "", errors);
  return errors;
}

// src/gateway.ts
var ToolTimeoutError = class extends Error {
  toolName;
  timeoutMs;
  constructor(toolName, timeoutMs) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
};
function withTimeout(promise, timeoutMs, toolName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
var ToolGateway = class {
  tools = /* @__PURE__ */ new Map();
  middlewares = [];
  defaultTimeout;
  constructor(options = {}) {
    this.defaultTimeout = options.defaultTimeout;
  }
  use(middleware) {
    this.middlewares.push(middleware);
    return this;
  }
  register(tool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }
  has(name) {
    return this.tools.has(name);
  }
  get(name) {
    return this.tools.get(name);
  }
  getAll() {
    return Array.from(this.tools.values());
  }
  list() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description
    }));
  }
  async execute(name, input) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool with name "${name}" is not found.`);
    }
    const context = {
      name,
      input,
      tool
    };
    const dispatch = async (index) => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index];
        return middleware(context, () => dispatch(index + 1));
      }
      const fieldErrors = validateToolInput(tool.parameters, context.input);
      if (fieldErrors.length > 0) {
        throw new ToolInputValidationError(name, fieldErrors);
      }
      const timeout = tool.timeout ?? this.defaultTimeout;
      const executed = Promise.resolve(tool.execute(context.input));
      if (typeof timeout === "number" && timeout > 0) {
        return withTimeout(executed, timeout, name);
      }
      return executed;
    };
    return await dispatch(0);
  }
  async executeMany(calls) {
    return Promise.all(
      calls.map((call) => this.execute(call.name, call.input))
    );
  }
  /**
   * Like `executeMany`, but a failing tool does not reject the whole batch.
   * Each result is either `{ status: "fulfilled", value }` or
   * `{ status: "rejected", reason }` — suitable for agent loops that must
   * report per-call errors back to the model.
   */
  async executeManySettled(calls) {
    return Promise.allSettled(
      calls.map((call) => this.execute(call.name, call.input))
    );
  }
};
function createToolGateway(options) {
  return new ToolGateway(options);
}

// src/adapters/shared.ts
function toToolContent(output) {
  return typeof output === "string" ? output : JSON.stringify(output);
}
function toErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const json = JSON.stringify(error);
    return json !== void 0 ? json : String(error);
  } catch {
    return String(error);
  }
}

// src/adapters/openai.ts
function toOpenAITool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {
        type: "object",
        properties: {}
      }
    }
  };
}
function toOpenAITools(tools) {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toOpenAITool);
}
async function executeOpenAIToolCall(gateway, toolCall) {
  const name = toolCall.function.name;
  let input = {};
  if (toolCall.function.arguments) {
    try {
      input = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error(
        `Failed to parse arguments for tool "${name}": ${toolCall.function.arguments}`
      );
    }
  }
  const output = await gateway.execute(name, input);
  return {
    tool_call_id: toolCall.id,
    // `content` is a string ready to paste into a `role: "tool"` message;
    // `output` is the raw value for your own use.
    content: toToolContent(output),
    output
  };
}
async function executeOpenAIToolCalls(gateway, toolCalls) {
  return Promise.all(
    toolCalls.map((toolCall) => executeOpenAIToolCall(gateway, toolCall))
  );
}
async function executeOpenAIToolCallsSettled(gateway, toolCalls) {
  return Promise.all(
    toolCalls.map(async (toolCall) => {
      try {
        return await executeOpenAIToolCall(gateway, toolCall);
      } catch (error) {
        const message = toErrorMessage(error);
        return {
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: message }),
          output: null,
          error: message
        };
      }
    })
  );
}

// src/adapters/anthropic.ts
function toAnthropicTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? {
      type: "object",
      properties: {}
    }
  };
}
function toAnthropicTools(tools) {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toAnthropicTool);
}
async function executeAnthropicToolUse(gateway, toolUse) {
  const output = await gateway.execute(toolUse.name, toolUse.input);
  return {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content: toToolContent(output)
  };
}
async function executeAnthropicToolUses(gateway, toolUses) {
  return Promise.all(
    toolUses.map((toolUse) => executeAnthropicToolUse(gateway, toolUse))
  );
}
async function executeAnthropicToolUsesSettled(gateway, toolUses) {
  return Promise.all(
    toolUses.map(async (toolUse) => {
      try {
        return await executeAnthropicToolUse(gateway, toolUse);
      } catch (error) {
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: toErrorMessage(error) })
        };
      }
    })
  );
}

// src/adapters/gemini.ts
function toGeminiFunctionDeclaration(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
function toGeminiFunctionDeclarations(tools) {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toGeminiFunctionDeclaration);
}
function toGeminiTool(tools) {
  return {
    functionDeclarations: toGeminiFunctionDeclarations(tools)
  };
}
async function executeGeminiFunctionCall(gateway, functionCall) {
  const output = await gateway.execute(
    functionCall.name,
    functionCall.args ?? {}
  );
  const responseObj = typeof output === "object" && output !== null && !Array.isArray(output) ? output : { result: output };
  return {
    functionResponse: {
      name: functionCall.name,
      response: responseObj
    }
  };
}
async function executeGeminiFunctionCalls(gateway, functionCalls) {
  return Promise.all(
    functionCalls.map((call) => executeGeminiFunctionCall(gateway, call))
  );
}
async function executeGeminiFunctionCallsSettled(gateway, functionCalls) {
  return Promise.all(
    functionCalls.map(async (call) => {
      try {
        return await executeGeminiFunctionCall(gateway, call);
      } catch (error) {
        return {
          functionResponse: {
            name: call.name,
            response: { error: toErrorMessage(error) }
          }
        };
      }
    })
  );
}

// src/adapters/cohere.ts
function toJsonSchemaTypeToCohereType(prop) {
  const type = typeof prop?.type === "string" ? prop.type : void 0;
  switch (type) {
    case "string":
      return "str";
    case "integer":
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "array": {
      const items = prop?.items;
      const itemType = typeof items?.type === "string" ? items.type : void 0;
      return itemType ? `List[${typeToCohereScalar(itemType)}]` : "List";
    }
    case "object":
      return "Dict";
    default:
      return "dynamic";
  }
}
function typeToCohereScalar(type) {
  switch (type) {
    case "string":
      return "str";
    case "integer":
      return "int";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    default:
      return type;
  }
}
function toCohereTool(tool) {
  let parameter_definitions;
  if (tool.parameters && typeof tool.parameters === "object") {
    const rawProps = tool.parameters.properties ?? {};
    const requiredList = Array.isArray(tool.parameters.required) ? tool.parameters.required : [];
    parameter_definitions = {};
    for (const [key, prop] of Object.entries(rawProps)) {
      parameter_definitions[key] = {
        description: typeof prop?.description === "string" ? prop.description : "",
        type: toJsonSchemaTypeToCohereType(prop),
        required: requiredList.includes(key)
      };
    }
  }
  return {
    name: tool.name,
    description: tool.description,
    parameter_definitions
  };
}
function toCohereTools(tools) {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toCohereTool);
}
async function executeCohereToolCall(gateway, toolCall) {
  const output = await gateway.execute(
    toolCall.name,
    toolCall.parameters ?? {}
  );
  const outputObj = typeof output === "object" && output !== null && !Array.isArray(output) ? output : { result: output };
  return {
    call: toolCall,
    outputs: [outputObj]
  };
}
async function executeCohereToolCalls(gateway, toolCalls) {
  return Promise.all(
    toolCalls.map((call) => executeCohereToolCall(gateway, call))
  );
}
async function executeCohereToolCallsSettled(gateway, toolCalls) {
  return Promise.all(
    toolCalls.map(async (call) => {
      try {
        return await executeCohereToolCall(gateway, call);
      } catch (error) {
        return { call, outputs: [{ error: toErrorMessage(error) }] };
      }
    })
  );
}
function toCohereV2Tool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {
        type: "object",
        properties: {}
      }
    }
  };
}
function toCohereV2Tools(tools) {
  const toolList = Array.isArray(tools) ? tools : tools.getAll();
  return toolList.map(toCohereV2Tool);
}
async function executeCohereV2ToolCall(gateway, toolCall) {
  const name = toolCall.function.name;
  let input = {};
  if (toolCall.function.arguments) {
    try {
      input = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error(
        `Failed to parse arguments for tool "${name}": ${toolCall.function.arguments}`
      );
    }
  }
  const output = await gateway.execute(name, input);
  const data = typeof output === "string" ? output : JSON.stringify(output);
  return {
    tool_call_id: toolCall.id,
    content: [{ type: "document", document: { data } }]
  };
}
async function executeCohereV2ToolCalls(gateway, toolCalls) {
  return Promise.all(
    toolCalls.map((call) => executeCohereV2ToolCall(gateway, call))
  );
}
async function executeCohereV2ToolCallsSettled(gateway, toolCalls) {
  return Promise.all(
    toolCalls.map(async (call) => {
      try {
        return await executeCohereV2ToolCall(gateway, call);
      } catch (error) {
        return {
          tool_call_id: call.id,
          content: [
            {
              type: "document",
              document: { data: JSON.stringify({ error: toErrorMessage(error) }) }
            }
          ]
        };
      }
    })
  );
}

// src/adapters/vercel.ts
async function loadJsonSchema() {
  const specifier = "ai";
  const mod = await import(specifier);
  if (typeof mod.jsonSchema !== "function") {
    throw new Error(
      'The Vercel AI SDK adapter requires the "ai" package (AI SDK >= 4.3). Install it with: npm install ai'
    );
  }
  return mod.jsonSchema;
}
async function toVercelTool(gateway, tool) {
  const jsonSchema = await loadJsonSchema();
  return {
    description: tool.description,
    inputSchema: jsonSchema(
      tool.parameters ?? {
        type: "object",
        properties: {}
      }
    ),
    execute: (args) => gateway.execute(tool.name, args)
  };
}
async function toVercelTools(tools, gateway) {
  const gw = "getAll" in tools ? tools : gateway;
  if (!gw) {
    throw new Error("ToolGateway instance must be provided to toVercelTools");
  }
  const toolList = "getAll" in tools ? tools.getAll() : tools;
  const toolSet = {};
  for (const tool of toolList) {
    toolSet[tool.name] = await toVercelTool(gw, tool);
  }
  return toolSet;
}

// src/handle.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function detectProvider(call) {
  if (!isRecord(call)) {
    throw new Error(
      `Unrecognized tool call: expected an object, got ${call === null ? "null" : typeof call}`
    );
  }
  if (call.type === "tool_use" && typeof call.id === "string") {
    return "anthropic";
  }
  if (typeof call.id === "string" && isRecord(call.function) && typeof call.function.name === "string") {
    return "openai";
  }
  if (typeof call.name === "string" && "args" in call) {
    return "gemini";
  }
  if (typeof call.name === "string" && "parameters" in call) {
    return "cohere-v1";
  }
  throw new Error(
    'Unrecognized tool call format. Expected an OpenAI/Cohere-v2 call ({ id, function: { name, arguments } }), an Anthropic tool_use ({ type: "tool_use", id, name, input }), a Gemini function call ({ name, args }), or a Cohere v1 call ({ name, parameters }).'
  );
}
async function runToolCalls(gateway, calls, options = {}) {
  const provider = options.provider ?? (calls.length > 0 ? detectProvider(calls[0]) : void 0);
  switch (provider) {
    case void 0:
      return [];
    case "openai":
      return executeOpenAIToolCallsSettled(
        gateway,
        calls
      );
    case "cohere-v2":
      return executeCohereV2ToolCallsSettled(
        gateway,
        calls
      );
    case "anthropic":
      return executeAnthropicToolUsesSettled(
        gateway,
        calls
      );
    case "gemini":
      return executeGeminiFunctionCallsSettled(
        gateway,
        calls
      );
    case "cohere-v1":
      return executeCohereToolCallsSettled(
        gateway,
        calls
      );
    default:
      throw new Error(`Unsupported provider: ${String(provider)}`);
  }
}
async function runToolCall(gateway, call, options = {}) {
  const provider = options.provider ?? detectProvider(call);
  switch (provider) {
    case "openai":
      return executeOpenAIToolCall(gateway, call);
    case "cohere-v2":
      return executeCohereV2ToolCall(gateway, call);
    case "anthropic":
      return executeAnthropicToolUse(gateway, call);
    case "gemini":
      return executeGeminiFunctionCall(gateway, call);
    case "cohere-v1":
      return executeCohereToolCall(gateway, call);
    default:
      throw new Error(`Unsupported provider: ${String(provider)}`);
  }
}
async function toTools(tools, format) {
  switch (format) {
    case "openai":
      return toOpenAITools(tools);
    case "anthropic":
      return toAnthropicTools(tools);
    case "gemini":
      return toGeminiTool(tools);
    case "gemini-declarations":
      return toGeminiFunctionDeclarations(tools);
    case "cohere":
      return toCohereTools(tools);
    case "cohere-v2":
      return toCohereV2Tools(tools);
    case "vercel":
      return toVercelTools(tools);
    default:
      throw new Error(`Unsupported tool format: ${String(format)}`);
  }
}
export {
  ToolGateway,
  ToolInputValidationError,
  ToolTimeoutError,
  createToolGateway,
  detectProvider,
  executeAnthropicToolUse,
  executeAnthropicToolUses,
  executeAnthropicToolUsesSettled,
  executeCohereToolCall,
  executeCohereToolCalls,
  executeCohereToolCallsSettled,
  executeCohereV2ToolCall,
  executeCohereV2ToolCalls,
  executeCohereV2ToolCallsSettled,
  executeGeminiFunctionCall,
  executeGeminiFunctionCalls,
  executeGeminiFunctionCallsSettled,
  executeOpenAIToolCall,
  executeOpenAIToolCalls,
  executeOpenAIToolCallsSettled,
  runToolCall,
  runToolCalls,
  toAnthropicTool,
  toAnthropicTools,
  toCohereTool,
  toCohereTools,
  toCohereV2Tool,
  toCohereV2Tools,
  toGeminiFunctionDeclaration,
  toGeminiFunctionDeclarations,
  toGeminiTool,
  toOpenAITool,
  toOpenAITools,
  toTools,
  toVercelTool,
  toVercelTools,
  validateToolInput
};
