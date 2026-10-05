const SENSITIVE_KEY = /(?:api[_-]?key|authorization|token|secret|password|cookie|credential)/i;
const SAFE_TOKEN_METRIC_KEY = /^(?:input|output|total)Tokens$/;
const SENSITIVE_ASSIGNMENT =
  /((?:["']?)(?:api[_ -]?key|authorization|token|secret|password|cookie|credential)(?:["']?)\s*[:=]\s*(?:["']?))([^"'\s,;}\]]+)/gi;
const BEARER_VALUE = /(\bbearer\s+)[A-Za-z0-9._~+/=-]+/gi;
// Matches WORKSPACE_LIMITS.maxReadCharacters so a bounded tool result is retained in full.
const DEFAULT_MAX_STRING_LENGTH = 24_000;
const MAX_DEPTH = 8;

export type SafeJsonValue =
  | null
  | boolean
  | number
  | string
  | SafeJsonValue[]
  | { [key: string]: SafeJsonValue };

export type SafeJsonOptions = {
  maxStringLength?: number;
  /** Keys whose values must not enter the current log sink. */
  omitKeys?: RegExp;
};

function redactText(value: string): string {
  return value
    .replace(SENSITIVE_ASSIGNMENT, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(BEARER_VALUE, (_match, prefix: string) => `${prefix}[REDACTED]`);
}

function boundedText(value: string, maxLength: number): string {
  const redacted = redactText(value);
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}… [truncated ${redacted.length - maxLength} chars]`;
}

function isBinary(value: object): boolean {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

function safeError(
  error: Error,
  maxLength: number,
  seen: WeakSet<object>,
  depth: number,
): SafeJsonValue {
  if (seen.has(error)) return "[circular reference omitted]";
  seen.add(error);
  const value: Record<string, SafeJsonValue> = {
    name: boundedText(error.name, maxLength),
    message: boundedText(error.message, maxLength),
  };
  if (error.stack) value.stack = boundedText(error.stack, maxLength);
  if ("cause" in error && error.cause !== undefined) {
    value.cause = sanitizeLogValue(error.cause, { maxStringLength: maxLength }, seen, depth + 1);
  }
  return value;
}

/**
 * Produces a bounded JSON-compatible value for worker logs. It intentionally
 * omits binary values and keys conventionally used for credentials.
 */
export function sanitizeLogValue(
  input: unknown,
  options: SafeJsonOptions = {},
  seen = new WeakSet<object>(),
  depth = 0,
): SafeJsonValue {
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return boundedText(input, maxStringLength);
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : String(input);
  if (typeof input === "bigint") return input.toString();
  if (typeof input === "symbol" || typeof input === "function") return `[${typeof input} omitted]`;
  if (depth >= MAX_DEPTH) return "[max depth reached]";
  if (input instanceof Error) return safeError(input, maxStringLength, seen, depth);
  if (typeof input !== "object") return "[unsupported value omitted]";
  if (isBinary(input)) return "[binary omitted]";
  if (seen.has(input)) return "[circular reference omitted]";
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((value) => sanitizeLogValue(value, options, seen, depth + 1));
  }

  const output: Record<string, SafeJsonValue> = {};
  for (const key of Object.keys(input)) {
    const propertyValue = (input as Record<string, unknown>)[key];
    if (
      SENSITIVE_KEY.test(key) &&
      !(SAFE_TOKEN_METRIC_KEY.test(key) && typeof propertyValue === "number")
    ) {
      output[key] = "[REDACTED]";
      continue;
    }
    if (options.omitKeys?.test(key)) {
      output[key] = "[model payload omitted]";
      continue;
    }
    try {
      output[key] = sanitizeLogValue(propertyValue, options, seen, depth + 1);
    } catch {
      output[key] = "[unreadable property omitted]";
    }
  }
  return output;
}

export function serializeError(error: unknown): SafeJsonValue {
  return sanitizeLogValue(error);
}
