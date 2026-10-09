import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolMiddleware,
  ToolSummary,
} from "./types";
import { ToolInputValidationError, validateToolInput } from "./validation";

export interface ToolGatewayOptions {
  /**
   * Default per-call execution timeout in milliseconds applied to every
   * tool. A tool's own `timeout` field overrides it. `0`/`undefined` means
   * no timeout.
   */
  defaultTimeout?: number;
}

export class ToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, timeoutMs);
    // Do not let the timer keep the process alive (no-op where unsupported).
    (timer as { unref?: () => void }).unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class ToolGateway {
  private tools = new Map<string, ToolDefinition>();
  private middlewares: ToolMiddleware[] = [];
  private defaultTimeout?: number;

  constructor(options: ToolGatewayOptions = {}) {
    this.defaultTimeout = options.defaultTimeout;
  }

  use(middleware: ToolMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  register<TInput, TOutput>(
    tool: ToolDefinition<TInput, TOutput>,
  ): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  list(): ToolSummary[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  async execute<TOutput = unknown>(
    name: string,
    input: unknown,
  ): Promise<TOutput> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool with name "${name}" is not found.`);
    }

    const context: ToolExecutionContext = {
      name,
      input,
      tool,
    };

    const dispatch = async (index: number): Promise<unknown> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index];
        return middleware(context, () => dispatch(index + 1));
      }
      // Validate model-supplied input against the declared JSON Schema before
      // invoking the tool. Thrown here (innermost) so guardrails / error-
      // recovery middleware can intercept it. Tools without a `parameters`
      // schema are skipped (nothing to validate against).
      const fieldErrors = validateToolInput(tool.parameters, context.input);
      if (fieldErrors.length > 0) {
        throw new ToolInputValidationError(name, fieldErrors);
      }
      // The timeout wraps only the tool body (innermost layer) so a
      // ToolTimeoutError propagates back through the middleware chain and can
      // be logged / recovered. The timer bounds the wait but cannot cancel
      // in-flight side effects.
      const timeout = tool.timeout ?? this.defaultTimeout;
      const executed = Promise.resolve(tool.execute(context.input));
      if (typeof timeout === "number" && timeout > 0) {
        return withTimeout(executed, timeout, name);
      }
      return executed;
    };

    return (await dispatch(0)) as TOutput;
  }

  async executeMany(
    calls: Array<{ name: string; input: unknown }>,
  ): Promise<unknown[]> {
    return Promise.all(
      calls.map((call) => this.execute(call.name, call.input)),
    );
  }

  /**
   * Like `executeMany`, but a failing tool does not reject the whole batch.
   * Each result is either `{ status: "fulfilled", value }` or
   * `{ status: "rejected", reason }` — suitable for agent loops that must
   * report per-call errors back to the model.
   */
  async executeManySettled(
    calls: Array<{ name: string; input: unknown }>,
  ): Promise<
    Array<
      | { status: "fulfilled"; value: unknown }
      | { status: "rejected"; reason: unknown }
    >
  > {
    return Promise.allSettled(
      calls.map((call) => this.execute(call.name, call.input)),
    );
  }
}

export function createToolGateway(options?: ToolGatewayOptions): ToolGateway {
  return new ToolGateway(options);
}