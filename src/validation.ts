/**
 * Minimal, dependency-free JSON Schema validation for tool inputs.
 *
 * Supports the subset of JSON Schema that AI models actually produce
 * through tool-calling: type, properties, required, items, enum,
 * additionalProperties (false), minimum/maximum, minProperties/
 * maxProperties, minLength/maxLength, and pattern.
 *
 * Validation is intentionally lenient about schema features it does not
 * understand (they are skipped), so declaring a richer schema never breaks
 * execution — but the supported constraints are enforced strictly.
 */

export class ToolInputValidationError extends Error {
  readonly toolName: string;
  readonly fields: string[];

  constructor(toolName: string, fields: string[]) {
    super(
      `Invalid input for tool "${toolName}": ` +
        fields.map((f) => (f === "" ? "(root)" : f)).join("; "),
    );
    this.name = "ToolInputValidationError";
    this.toolName = toolName;
    this.fields = fields;
  }
}

type JsonSchema = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
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

function matchesType(value: unknown, type: string): boolean {
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
      // Unknown type keywords are skipped (lenient).
      return true;
  }
}

function validateNode(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isObject(schema)) return;

  // type (string or array of strings)
  const type = schema.type;
  if (typeof type === "string") {
    if (!matchesType(value, type)) {
      errors.push(
        `${path || "(root)"}: expected type ${type}, got ${describeValue(value)}`,
      );
      return; // Type mismatch — further checks are meaningless.
    }
  } else if (Array.isArray(type) && type.length > 0) {
    if (!type.some((t) => matchesType(value, String(t)))) {
      errors.push(
        `${path || "(root)"}: expected type [${type.join(", ")}], got ${describeValue(value)}`,
      );
      return;
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    const allowed = schema.enum as unknown[];
    if (!allowed.some((option) => deepEqual(value, option))) {
      errors.push(
        `${path || "(root)"}: value ${JSON.stringify(value)} is not one of ` +
          `[${allowed.map((o) => JSON.stringify(o)).join(", ")}]`,
      );
    }
  }

  // string constraints
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
        // Invalid regex in schema — skip (lenient).
      }
    }
  }

  // number constraints
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

  // object constraints
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
            propSchema as JsonSchema,
            value[key],
            path ? `${path}.${key}` : key,
            errors,
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

  // array constraints
  if (Array.isArray(value)) {
    const items = schema.items;
    if (isObject(items)) {
      value.forEach((item, i) => {
        validateNode(items as JsonSchema, item, `${path}[${i}]`, errors);
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

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validate an input value against a tool's `parameters` JSON Schema.
 * Returns a list of human-readable field errors; an empty list means valid.
 * Returns an empty list immediately when no schema is declared.
 */
export function validateToolInput(
  parameters: unknown,
  input: unknown,
): string[] {
  if (!isObject(parameters)) return [];
  const errors: string[] = [];
  validateNode(parameters, input, "", errors);
  return errors;
}
