import {
  captureFailureArtifact,
  ensureLoggedIn,
  forceRelogin,
  openConnpassSession,
  tryGetLiveViewUrl,
} from "./browser.server";
import { type UpsertConferenceInput, upsertConference } from "./connpass-ui/conference";
import {
  type EventEditFields,
  cancelSubEvent,
  createEventDraft,
  createSubEventDraft,
  fillEventEdit,
  publishEvent,
} from "./connpass-ui/events";
import {
  cancelEvent,
  copyEvent,
  deleteEventDraft,
  uploadEventImage,
} from "./connpass-ui/lifecycle";
import { sendEventMessage, updateParticipant } from "./connpass-ui/participants";
import { type SurveyQuestion, upsertSurvey } from "./connpass-ui/survey";
import {
  type VoucherRecipientWrite,
  deleteVoucherRecipient,
  saveVoucherRecipient,
} from "./connpass-ui/vouchers";
import {
  type JobQueueMessage,
  type JobRecord,
  getJob,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
} from "./jobs.server";

export type { JobQueueMessage };

type CreateEventRequest = EventEditFields & { title: string };
type UpdateEventRequest = EventEditFields;
type PublishEventRequest = { postToTwitter?: boolean; comment?: string | null };
type CreateSubEventRequest = { title: string };
type DeleteSubEventRequest = Record<string, never>;
type UpsertSurveyRequest = { questions: SurveyQuestion[] };
type UpsertConferenceRequest = UpsertConferenceInput;
type UploadEventImageRequest = { artifactKey: string; contentType: string; name: string };
type UpdateParticipantRequest = {
  participantId: string;
  input: Parameters<typeof updateParticipant>[3];
};
type EventMessageRequest = { subject: string; body: string; recipients?: string };
type VoucherRequest = { voucherId?: string; input: VoucherRecipientWrite };

function parseRequest<T>(job: JobRecord): T {
  return JSON.parse(job.requestJson) as T;
}

async function runWithBrowser(
  env: Env,
  job: JobRecord,
  run: (page: Awaited<ReturnType<typeof openConnpassSession>>["page"]) => Promise<{
    result: unknown;
    eventId?: string | null;
  }>,
): Promise<void> {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const { result, eventId } = await run(session.page);
    await session.persist();
    await markJobSucceeded(env.DB, job.id, result, eventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("login")) {
      try {
        await forceRelogin(env);
      } catch {
        // fall through
      }
    }
    const liveView = await tryGetLiveViewUrl(session.page);
    const artifactKey = await captureFailureArtifact(env, job.id, session.page);
    const detail = liveView ? `${message}; liveView=${liveView}` : message;
    await markJobFailed(env.DB, job.id, detail, artifactKey);
    throw error;
  } finally {
    await session.close();
  }
}

export async function processJobMessage(
  env: Env,
  _ctx: ExecutionContext,
  message: JobQueueMessage,
): Promise<void> {
  const job = await getJob(env.DB, message.jobId);
  if (!job) return;
  if (job.status === "succeeded" || job.status === "failed") return;

  const claimed = await markJobRunning(env.DB, job.id);
  if (!claimed) return;

  if (job.type === "relogin") {
    try {
      await forceRelogin(env);
      await markJobSucceeded(env.DB, job.id, { ok: true });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await markJobFailed(env.DB, job.id, messageText);
      throw error;
    }
    return;
  }

  if (job.type === "create_event") {
    const request = parseRequest<CreateEventRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      const created = await createEventDraft(page, job.groupSlug, request.title);
      await fillEventEdit(page, request);
      return {
        eventId: created.eventId,
        result: {
          eventId: created.eventId,
          editUrl: created.editUrl,
          publicUrl: `https://connpass.com/event/${created.eventId}/`,
        },
      };
    });
    return;
  }

  if (job.type === "update_event") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<UpdateEventRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await page.goto(`https://connpass.com/event/${job.eventId}/edit/`, {
        waitUntil: "domcontentloaded",
      });
      await fillEventEdit(page, request);
      return {
        eventId: job.eventId,
        result: {
          eventId: job.eventId,
          editUrl: `https://connpass.com/event/${job.eventId}/edit/`,
        },
      };
    });
    return;
  }

  if (job.type === "publish_event") {
    const eventId = job.eventId;
    if (!eventId) throw new Error("event_id_required");
    const request = parseRequest<PublishEventRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await publishEvent(page, eventId, request);
      return {
        eventId,
        result: {
          eventId,
          publicUrl: `https://connpass.com/event/${eventId}/`,
        },
      };
    });
    return;
  }

  if (job.type === "create_sub_event") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<CreateSubEventRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      const created = await createSubEventDraft(page, job.eventId as string, request.title);
      return {
        eventId: created.eventId,
        result: {
          eventId: created.eventId,
          editUrl: created.editUrl,
          publicUrl: `https://connpass.com/event/${created.eventId}/`,
        },
      };
    });
    return;
  }

  if (job.type === "delete_sub_event") {
    const subEventId = job.eventId;
    if (!subEventId) throw new Error("event_id_required");
    parseRequest<DeleteSubEventRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await cancelSubEvent(page, subEventId);
      return { eventId: subEventId, result: { eventId: subEventId, canceled: true } };
    });
    return;
  }

  if (job.type === "upsert_survey") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<UpsertSurveyRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await upsertSurvey(page, job.eventId as string, request.questions);
      return { eventId: job.eventId, result: { eventId: job.eventId } };
    });
    return;
  }

  if (job.type === "upsert_conference") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<UpsertConferenceRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await upsertConference(page, job.eventId as string, request);
      return { eventId: job.eventId, result: { eventId: job.eventId } };
    });
    return;
  }

  if (job.type === "upload_event_image") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<UploadEventImageRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      const object = await env.ARTIFACTS.get(request.artifactKey);
      if (!object) throw new Error("event_image_missing");
      try {
        await uploadEventImage(
          page,
          job.eventId as string,
          new Uint8Array(await object.arrayBuffer()),
          request.contentType,
          request.name,
        );
      } finally {
        await env.ARTIFACTS.delete(request.artifactKey);
      }
      return { eventId: job.eventId, result: { eventId: job.eventId } };
    });
    return;
  }

  if (job.type === "copy_event") {
    if (!job.eventId) throw new Error("event_id_required");
    await runWithBrowser(env, job, async (page) => {
      const copied = await copyEvent(page, job.eventId as string);
      return { eventId: copied.eventId, result: { eventId: copied.eventId } };
    });
    return;
  }

  if (job.type === "delete_event_draft" || job.type === "cancel_event") {
    if (!job.eventId) throw new Error("event_id_required");
    await runWithBrowser(env, job, async (page) => {
      if (job.type === "delete_event_draft") await deleteEventDraft(page, job.eventId as string);
      else await cancelEvent(page, job.eventId as string);
      return { eventId: job.eventId, result: { eventId: job.eventId } };
    });
    return;
  }

  if (job.type === "update_participant") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<UpdateParticipantRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await updateParticipant(page, job.eventId as string, request.participantId, request.input);
      return {
        eventId: job.eventId,
        result: { eventId: job.eventId, participantId: request.participantId },
      };
    });
    return;
  }

  if (job.type === "send_event_message") {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<EventMessageRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      await sendEventMessage(page, job.eventId as string, request);
      return { eventId: job.eventId, result: { eventId: job.eventId } };
    });
    return;
  }

  if (
    job.type === "create_voucher_recipient" ||
    job.type === "update_voucher_recipient" ||
    job.type === "delete_voucher_recipient"
  ) {
    if (!job.eventId) throw new Error("event_id_required");
    const request = parseRequest<VoucherRequest>(job);
    await runWithBrowser(env, job, async (page) => {
      if (job.type === "delete_voucher_recipient") {
        if (!request.voucherId) throw new Error("voucher_id_required");
        await deleteVoucherRecipient(page, job.eventId as string, request.voucherId);
      } else {
        await saveVoucherRecipient(page, job.eventId as string, request.input, request.voucherId);
      }
      return {
        eventId: job.eventId,
        result: { eventId: job.eventId, voucherId: request.voucherId },
      };
    });
    return;
  }

  await markJobFailed(env.DB, job.id, `unknown_job_type:${job.type}`);
}
