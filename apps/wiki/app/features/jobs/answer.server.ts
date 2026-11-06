import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import {
  type AgentReader,
  issueJobToken,
  revokeJobTokens,
} from "~/features/agent-api/agent-reader.server";
import { listAccessibleSpaces, resolveSpaceAccess } from "~/features/spaces/access.server";
import { DEFAULT_SPACE_ID } from "~/features/spaces/shared";
import type { getDb } from "~/lib/db.server";
import { JOB_PRIORITY } from "./shared";

type Db = ReturnType<typeof getDb>;

/** The agent Worker degrades to search results after this; the runner aims for 75 s. */
export const ANSWER_DEADLINE_SECONDS = 90;
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const BUNDLE_PATH = /^(question\.md|INSTRUCTIONS\.md|(index|hits|raw)\/[A-Za-z0-9_.-]+\.md)$/;

export type AnswerPayload = {
  question: string;
  spaces: string[];
  reader: Pick<AgentReader, "identity" | "extraPrincipals">;
};

export const bundleKey = (jobId: string) => `jobs/${jobId}/bundle.json`;

export function validateBundle(bundle: unknown): Record<string, string> | null {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return null;
  let bytes = 0;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(bundle)) {
    if (!BUNDLE_PATH.test(path) || typeof content !== "string") return null;
    bytes += content.length;
    out[path] = content;
  }
  return bytes <= MAX_BUNDLE_BYTES && "question.md" in out ? out : null;
}

/**
 * Queue an `answer` job for a reader. Spaces are narrowed to the reader's reachable ones
 * here (the agent Worker can only narrow, never widen). The bundle goes to R2; the job token
 * is issued later, when the runner fetches the bundle.
 */
export async function enqueueAnswer(
  env: Env,
  db: Db,
  reader: AgentReader,
  input: { question: string; spaces: readonly string[]; bundle: Record<string, string> },
): Promise<{ jobId: string; deadlineAt: number }> {
  const access = await resolveSpaceAccess(db, reader.identity, reader.extraPrincipals);
  const reachable = await listAccessibleSpaces(db, access);
  const spaces = reachable.filter(
    (space) => input.spaces.length === 0 || input.spaces.includes(space.slug),
  );
  const jobId = nanoid();
  const deadline = Math.floor(Date.now() / 1000) + ANSWER_DEADLINE_SECONDS;
  await env.BUCKET.put(bundleKey(jobId), JSON.stringify(input.bundle), {
    httpMetadata: { contentType: "application/json" },
  });
  const payload: AnswerPayload = {
    question: input.question.slice(0, 2000),
    spaces: spaces.map((space) => space.slug),
    reader: { identity: reader.identity, extraPrincipals: reader.extraPrincipals },
  };
  await db.insert(schema.agentJobs).values({
    id: jobId,
    type: "answer",
    spaceId: spaces[0]?.id ?? DEFAULT_SPACE_ID,
    priority: JOB_PRIORITY.answer,
    payload: JSON.stringify(payload),
    deadlineAt: new Date(deadline * 1000),
  });
  return { jobId, deadlineAt: deadline };
}

/** Runner: the bundle and a fresh asker-scoped job token (earlier ones are revoked). */
export async function leaseAnswerBundle(
  env: Env,
  db: Db,
  jobId: string,
): Promise<{ files: Record<string, string>; jobToken: string; spaces: string[] } | null> {
  const job = await db
    .select()
    .from(schema.agentJobs)
    .where(
      and(
        eq(schema.agentJobs.id, jobId),
        eq(schema.agentJobs.type, "answer"),
        eq(schema.agentJobs.status, "leased"),
      ),
    )
    .get();
  if (!job) return null;
  const object = await env.BUCKET.get(bundleKey(jobId));
  if (!object) return null;
  const payload = JSON.parse(job.payload) as AnswerPayload;
  await revokeJobTokens(db, jobId);
  const jobToken = await issueJobToken(db, jobId, payload.reader);
  return { files: JSON.parse(await object.text()), jobToken, spaces: payload.spaces };
}

/** The agent Worker gave up waiting (degraded reply). */
export async function expireAnswer(env: Env, db: Db, jobId: string): Promise<boolean> {
  const result = await db
    .update(schema.agentJobs)
    .set({ status: "expired", finishedAt: new Date(), leaseUntil: null })
    .where(
      and(
        eq(schema.agentJobs.id, jobId),
        eq(schema.agentJobs.type, "answer"),
        inArray(schema.agentJobs.status, ["queued", "leased"]),
      ),
    );
  await finishAnswer(env, db, jobId);
  return (result.meta?.changes ?? 0) > 0;
}

/** On any end of an answer job: revoke its tokens and drop its bundle. */
export async function finishAnswer(env: Env, db: Db, jobId: string): Promise<void> {
  await revokeJobTokens(db, jobId);
  await env.BUCKET.delete(bundleKey(jobId)).catch(() => undefined);
}

/** Tell the agent Worker (service binding AGENT) that a runner result is in. */
export async function notifyAgent(
  env: Env,
  input: { jobId: string; status: string; result?: unknown },
): Promise<void> {
  const binding = (env as unknown as { AGENT?: Fetcher }).AGENT;
  const secret = (env as unknown as { AGENT_SERVICE_TOKEN?: string }).AGENT_SERVICE_TOKEN;
  if (!binding || !secret) return;
  try {
    await binding.fetch("https://agent.gdgs.jp/internal/answer-ready", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (error) {
    console.error("answer: agent notification failed", error);
  }
}
