import type { ConnpassJobSummary, ConnpassPrService, PrActor, PrRpcResult } from "@gdgjp/gdg-lib";
import { nanoid } from "nanoid";
import { groupForPrActor } from "~/features/auth/rpc-access.server";
import {
  getEventStatisticsInBrowser,
  getParticipantsInBrowser,
} from "~/features/connpass/connpass-browser-read.server";
import { parseEventWriteFields } from "~/features/connpass/event-fields";
import { parseSurveyQuestions } from "~/features/connpass/survey-questions";
import { jobToJson } from "./job-presentation";
import { getJob } from "./job-repository.server";
import { createJob } from "./job-submission.server";
import type { JobRecord, JobType } from "./job-types";

/** The calls pr.gdgs.jp makes through the PrService entrypoint (workers/app.ts). */

type In<K extends keyof ConnpassPrService> = Parameters<ConnpassPrService[K]>[0];
const fail = (code: string, message?: string) => ({ ok: false as const, code, message });
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const MAX_IMAGE_BYTES = 1024 * 1024;

const summary = (job: JobRecord): ConnpassJobSummary => {
  const { id, type, status, groupId, eventId, result, error } = jobToJson(job);
  return { id, type, status, groupId, eventId, result, error };
};

async function submit(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: { actor: PrActor; groupSlug: string; eventId: string | null },
  type: JobType,
  request: unknown,
): Promise<PrRpcResult<{ job: ConnpassJobSummary }>> {
  const group = await groupForPrActor(env.DB, input.actor, input.groupSlug, true);
  if (!group) return fail("forbidden");
  const job = await createJob(
    env,
    {
      type,
      groupSlug: group.groupSlug,
      eventId: input.eventId,
      request,
      createdBy: input.actor.user.id,
    },
    ctx,
  );
  return { ok: true, job: summary(job) };
}

export async function prCheckGroup(env: Env, input: In<"checkGroup">) {
  const read = await groupForPrActor(env.DB, input.actor, input.groupSlug, false);
  if (!read) return fail("forbidden");
  const write = !!(await groupForPrActor(env.DB, input.actor, input.groupSlug, true));
  return { ok: true as const, write, chapterId: read.chapterId };
}

export async function prUpdateEvent(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: In<"updateEvent">,
) {
  const parsed = parseEventWriteFields(input.fields as Record<string, unknown>);
  if ("error" in parsed) return fail("invalid_fields", parsed.error);
  if (Object.values(parsed.fields).every((v) => v === undefined))
    return fail("event_fields_required");
  return submit(env, ctx, input, "update_event", parsed.fields);
}

export const prPublishEvent = (
  env: Env,
  ctx: ExecutionContext | undefined,
  input: In<"publishEvent">,
) => submit(env, ctx, input, "publish_event", {});

export async function prUploadImage(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: In<"uploadImage">,
) {
  if (!IMAGE_TYPES.has(input.contentType) || input.bytes.byteLength > MAX_IMAGE_BYTES)
    return fail("invalid_event_image", "PNG / JPEG / GIF, 1 MB or less");
  if (!(await groupForPrActor(env.DB, input.actor, input.groupSlug, true)))
    return fail("forbidden");
  const artifactKey = `event-images/${nanoid(16)}`;
  await env.ARTIFACTS.put(artifactKey, input.bytes, {
    httpMetadata: { contentType: input.contentType },
  });
  return submit(env, ctx, input, "upload_event_image", {
    artifactKey,
    contentType: input.contentType,
    name: input.name,
  });
}

export async function prUpsertSurvey(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: In<"upsertSurvey">,
) {
  const questions = parseSurveyQuestions(input.questions);
  if (!questions) return fail("invalid_questions");
  return submit(env, ctx, input, "upsert_survey", { questions });
}

export async function prSendMessage(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: In<"sendMessage">,
) {
  if (!input.subject.trim() || !input.body.trim()) return fail("invalid_body");
  return submit(env, ctx, input, "send_event_message", {
    subject: input.subject,
    body: input.body,
  });
}

export async function prCreateSubEvent(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: In<"createSubEvent">,
) {
  if (!input.title.trim()) return fail("invalid_body");
  return submit(env, ctx, input, "create_sub_event", { title: input.title.trim() });
}

export async function prGetJob(env: Env, input: In<"getJob">) {
  const job = await getJob(env.DB, input.jobId);
  if (!job) return fail("not_found");
  if (!(await groupForPrActor(env.DB, input.actor, job.groupSlug, false))) return fail("not_found");
  return { ok: true as const, job: summary(job) };
}

async function read<T>(env: Env, input: In<"getStats">, run: () => Promise<T>) {
  if (!(await groupForPrActor(env.DB, input.actor, input.groupSlug, false)))
    return fail("forbidden");
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    return fail("connpass_browser_error", error instanceof Error ? error.message : String(error));
  }
}

export async function prGetStats(env: Env, input: In<"getStats">) {
  const r = await read(env, input, () => getEventStatisticsInBrowser(env, input.eventId));
  return r.ok ? { ok: true as const, statistics: r.value } : r;
}

export async function prListParticipants(env: Env, input: In<"listParticipants">) {
  const r = await read(env, input, () => getParticipantsInBrowser(env, input.eventId));
  return r.ok ? { ok: true as const, participants: r.value } : r;
}
