import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolMiddleware,
  ToolSummary,
} from "./types";

export class ToolGateway {
  private tools = new Map<string, ToolDefinition>();
  private middlewares: ToolMiddleware[] = [];

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
      return tool.execute(context.input);
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
}

export function createToolGateway(): ToolGateway {
  return new ToolGateway();
}