import type { ToolGateway } from "../gateway";
import type { ToolDefinition, VercelAITool, VercelAIToolSet } from "../types";

/**
 * Load the AI SDK's `jsonSchema()` helper without making `ai` a hard
 * dependency.
 *
 * The AI SDK requires a tool's `inputSchema` to be a Zod schema or a JSON
 * schema wrapped with `jsonSchema()`, which attaches a runtime marker
 * (`Symbol(vercel.ai.schema)`) the SDK checks when converting tools for the
 * provider. A plain JSON object is rejected with `schema is not a function`,
 * so the adapter must wrap the schema.
 *
 * `ai` is only needed by consumers of this adapter, so it is imported lazily
 * via a dynamic import. A non-literal specifier is used so TypeScript does
 * not require the `ai` module to be present at build time.
 */
async function loadJsonSchema(): Promise<
  (schema: Record<string, unknown>) => unknown
> {
  const specifier = "ai";
  const mod = (await import(specifier)) as {
    jsonSchema?: (schema: Record<string, unknown>) => unknown;
  };

  if (typeof mod.jsonSchema !== "function") {
    throw new Error(
      'The Vercel AI SDK adapter requires the "ai" package (AI SDK >= 4.3). Install it with: npm install ai',
    );
  }

  return mod.jsonSchema;
}

export async function toVercelTool(
  gateway: ToolGateway,
  tool: ToolDefinition,
): Promise<VercelAITool> {
  const jsonSchema = await loadJsonSchema();

  return {
    description: tool.description,
    inputSchema: jsonSchema(
      tool.parameters ?? {
        type: "object",
        properties: {},
      },
    ),
    execute: (args: unknown) => gateway.execute(tool.name, args),
  };
}

export async function toVercelTools(
  tools: ToolDefinition[] | ToolGateway,
  gateway?: ToolGateway,
): Promise<VercelAIToolSet> {
  const gw = "getAll" in tools ? (tools as ToolGateway) : gateway;
  if (!gw) {
    throw new Error("ToolGateway instance must be provided to toVercelTools");
  }

  const toolList = "getAll" in tools ? tools.getAll() : tools;
  const toolSet: VercelAIToolSet = {};

  for (const tool of toolList) {
    toolSet[tool.name] = await toVercelTool(gw, tool);
  }

  return toolSet;
}
