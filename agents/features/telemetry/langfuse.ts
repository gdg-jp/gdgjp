import { LangfuseSpanProcessor } from "@langfuse/otel";

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const LANGFUSE_SPAN_PROCESSOR_KEY = Symbol.for("gdgjp.agents.langfuseSpanProcessor");

type LangfuseGlobal = typeof globalThis & {
  [LANGFUSE_SPAN_PROCESSOR_KEY]?: LangfuseSpanProcessor;
};

const SECRET_ENV_KEYS = [
  "GOOGLE_VERTEX_API_KEY",
  "IDP_CLIENT_SECRET",
  "RP_SESSION_SECRET",
  "TELEMETRY_ID_SALT",
  "LANGFUSE_SECRET_KEY",
  "TOKEN_ENCRYPTION_KEYS",
] as const;

export function telemetryKeysPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY?.trim() && env.LANGFUSE_SECRET_KEY?.trim());
}

function collectEnvSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return SECRET_ENV_KEYS.map((key) => env[key]?.trim()).filter((value): value is string =>
    Boolean(value),
  );
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  redacted = redacted.replace(JWT_PATTERN, "[REDACTED]");
  for (const secret of secrets) {
    if (redacted.includes(secret)) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, secrets));
  }
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = redactValue(entry, secrets);
    }
    return redacted;
  }
  return value;
}

function redactSerializedValue(data: string, secrets: readonly string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return redactString(data, secrets);
    }
    throw error;
  }
  return JSON.stringify(redactValue(parsed, secrets));
}

/** Deep-walk redactor for Langfuse span export (request-context-free). */
export function maskTelemetryData({ data }: { data: unknown }): unknown {
  const secrets = collectEnvSecrets();
  return typeof data === "string"
    ? redactSerializedValue(data, secrets)
    : redactValue(data, secrets);
}

/**
 * Shared through the Node.js global symbol registry because Next.js bundles instrumentation and
 * route handlers into independent webpack runtimes with independent module caches.
 */
export function getLangfuseSpanProcessor(): LangfuseSpanProcessor | null {
  if (!telemetryKeysPresent()) return null;

  const langfuseGlobal = globalThis as LangfuseGlobal;
  langfuseGlobal[LANGFUSE_SPAN_PROCESSOR_KEY] ??= new LangfuseSpanProcessor({
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    mask: maskTelemetryData,
    // Vercel serverless: export promptly; flushTelemetry() still force-flushes in after().
    exportMode: "immediate",
  });
  return langfuseGlobal[LANGFUSE_SPAN_PROCESSOR_KEY];
}
