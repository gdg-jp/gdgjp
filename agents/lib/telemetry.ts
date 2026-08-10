import { createHmac } from "node:crypto";
import { LangfuseClient } from "@langfuse/client";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import type { TelemetrySettings } from "ai";

import { getLangfuseSpanProcessor } from "./langfuse";
import { getVerifiedMessageId } from "./request-context";

export type InquirySpan = {
  update: (attributes: {
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
    statusMessage?: string;
  }) => void;
};

export type ObserveInquiryAttrs = {
  platform: string;
  chatUserId: string;
  /** Guild / space id for link lookup and propagated metadata (Discord guild). */
  spaceId?: string;
  /** Conversation scope for Langfuse session id (Discord channel; Google Chat thread). */
  sessionScopeId?: string;
  chapterSlugs?: readonly string[];
  model?: string;
};

type TelemetryEnv = {
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
};

export function isTelemetryEnabled(env: TelemetryEnv = process.env as TelemetryEnv): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY?.trim() && env.LANGFUSE_SECRET_KEY?.trim());
}

/**
 * HMAC-pseudonymize chat / space ids. Fail-closed: without a salt, never return the raw id.
 */
export function pseudonymize(
  value: string,
  salt: string | undefined = process.env.TELEMETRY_ID_SALT,
): string {
  const key = salt?.trim();
  if (!key) return "anon";
  return createHmac("sha256", key).update(value).digest("base64url").slice(0, 22);
}

export function agentTelemetry(
  functionId: string,
  metadata?: TelemetrySettings["metadata"],
): TelemetrySettings {
  return {
    isEnabled: isTelemetryEnabled(),
    functionId,
    recordInputs: true,
    recordOutputs: true,
    ...(metadata ? { metadata } : {}),
  };
}

const noopSpan: InquirySpan = { update() {} };

/**
 * One Chat question → one Langfuse root observation (`answer-inquiry`).
 * When telemetry is disabled, runs `fn` with a no-op span and touches no network.
 */
export async function observeInquiry<T>(
  attrs: ObserveInquiryAttrs,
  fn: (span: InquirySpan) => Promise<T>,
): Promise<T> {
  if (!isTelemetryEnabled()) {
    return fn(noopSpan);
  }

  const environment = process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || "development";
  const userId = pseudonymize(attrs.chatUserId);
  const sessionScope = attrs.sessionScopeId ?? attrs.spaceId ?? attrs.chatUserId;
  const sessionId = pseudonymize(`${attrs.platform}:${sessionScope}`);
  const messageId = getVerifiedMessageId();
  // propagateAttributes only accepts string metadata values (≤200 chars each).
  const propagatedMetadata: Record<string, string> = {
    ...(messageId ? { messageId } : {}),
    ...(attrs.model ? { model: attrs.model } : {}),
    ...(attrs.chapterSlugs ? { chapterSlugs: attrs.chapterSlugs.join(",").slice(0, 200) } : {}),
    ...(attrs.platform === "discord" && attrs.spaceId
      ? { guildId: pseudonymize(attrs.spaceId) }
      : {}),
  };

  return propagateAttributes(
    {
      userId,
      sessionId,
      tags: [attrs.platform, environment],
      metadata: propagatedMetadata,
    },
    () =>
      startActiveObservation(
        "answer-inquiry",
        async (span) => {
          return fn({
            update: (attributes) => {
              span.update(attributes);
            },
          });
        },
        { asType: "agent" },
      ),
  );
}

let langfuseClient: LangfuseClient | null | undefined;

/** Lazy singleton; null when telemetry is disabled. */
export function getLangfuseClient(): LangfuseClient | null {
  if (!isTelemetryEnabled()) return null;
  if (langfuseClient === undefined) {
    langfuseClient = new LangfuseClient();
  }
  return langfuseClient;
}

/** Test-only: drop the cached client so env changes take effect. */
export function resetLangfuseClientForTests(): void {
  langfuseClient = undefined;
}

/**
 * Flush OTel spans and queued Langfuse scores. Errors are swallowed —
 * Chat replies must not fail because telemetry flush failed.
 */
export async function flushTelemetry(): Promise<void> {
  try {
    const client = getLangfuseClient();
    await Promise.all([getLangfuseSpanProcessor()?.forceFlush(), client?.flush()]);
  } catch {
    // Bookkeeping only.
  }
}
