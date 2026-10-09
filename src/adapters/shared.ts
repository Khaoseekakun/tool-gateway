/**
 * Format a tool output as a string suitable for a provider tool-result
 * message. Strings pass through unchanged; everything else is JSON-encoded.
 */
export function toToolContent(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}

/** Normalize an unknown rejection into a safe, model-readable message. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const json = JSON.stringify(error);
    return json !== undefined ? json : String(error);
  } catch {
    return String(error);
  }
}
