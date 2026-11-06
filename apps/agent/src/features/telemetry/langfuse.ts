import type { Env } from "../../env";

/**
 * Langfuse over its public ingestion API (no SDK on Workers). Chat ids are HMAC'd with
 * TELEMETRY_ID_SALT; tokens and answer bundles are never sent.
 */
async function ingest(env: Env, batch: unknown[]): Promise<void> {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return;
  const base = (env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com").replace(/\/$/, "");
  try {
    await fetch(`${base}/api/public/ingestion`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ batch }),
    });
  } catch (error) {
    console.warn("agent: langfuse ingest failed", error);
  }
}

export async function pseudonymize(env: Env, value: string): Promise<string> {
  const salt = env.TELEMETRY_ID_SALT ?? "";
  if (!salt || !value) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(mac)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const event = (type: string, body: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  type,
  body,
});

export async function traceInquiry(
  env: Env,
  input: {
    jobId: string;
    platform: string;
    chatUserId: string;
    venue: string;
    question: string;
    output: string;
    spaces: string[];
    citedUrls: string[];
    degraded: boolean;
    latencyMs: number;
  },
): Promise<void> {
  await ingest(env, [
    event("trace-create", {
      id: input.jobId,
      name: "inquiry",
      userId: await pseudonymize(env, `${input.platform}:${input.chatUserId}`),
      input: input.question,
      output: input.output,
      metadata: {
        platform: input.platform,
        venue: input.venue,
        space_ids: input.spaces,
        cited_urls: input.citedUrls,
        degraded: input.degraded,
        latency_ms: input.latencyMs,
      },
    }),
  ]);
}

export async function sendFeedbackScore(
  env: Env,
  jobId: string,
  value: number,
  platform: string,
): Promise<void> {
  await ingest(env, [
    event("score-create", {
      id: crypto.randomUUID(),
      traceId: jobId,
      name: "user_feedback",
      value,
      comment: platform,
    }),
  ]);
}
