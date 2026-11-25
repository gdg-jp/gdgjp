import {
  type BrowserSession,
  captureFailureArtifact,
  ensureLoggedIn,
  forceRelogin,
  openConnpassSession,
  tryGetLiveViewUrl,
} from "../connpass/browser.server";
import type { EventEditFields } from "../connpass/event-fields";
import { type UpsertConferenceInput, upsertConference } from "../connpass/ui/conference";
import { createEventDraft, fillEventEdit, publishEvent } from "../connpass/ui/event-write";
import {
  cancelEvent,
  copyEvent,
  deleteEventDraft,
  uploadEventImage,
} from "../connpass/ui/lifecycle";
import { sendEventMessage, updateParticipant } from "../connpass/ui/participants";
import { cancelSubEvent, createSubEventDraft } from "../connpass/ui/sub-events";
import { type SurveyQuestion, upsertSurvey } from "../connpass/ui/survey";
import {
  type VoucherRecipientWrite,
  deleteVoucherRecipient,
  saveVoucherRecipient,
} from "../connpass/ui/vouchers";
import { getJob, markJobFailed, markJobRunning, markJobSucceeded } from "./job-repository.server";
import type { JobQueueMessage, JobRecord } from "./job-types";

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

type JobPage = BrowserSession["page"];
type JobOutcome = { result: unknown; eventId?: string | null };
type JobFailure = { detail: string; artifactKey: string | null };

function parseRequest<T>(job: JobRecord): T {
  return JSON.parse(job.requestJson) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jobBrowser(env: Env, jobId: string) {
  let session: BrowserSession | null = null;
  return {
    async page(): Promise<JobPage> {
      if (!session) {
        session = await openConnpassSession(env);
        await ensureLoggedIn(env, session);
      }
      return session.page;
    },
    async persist(): Promise<void> {
      await session?.persist();
    },
    async failure(message: string): Promise<JobFailure> {
      if (!session) return { detail: message, artifactKey: null };
      const liveView = await tryGetLiveViewUrl(session.page);
      const artifactKey = await captureFailureArtifact(env, jobId, session.page);
      if (message.includes("login")) {
        try {
          await forceRelogin(env);
        } catch {}
      }
      return { detail: liveView ? `${message}; liveView=${liveView}` : message, artifactKey };
    },
    async close(succeeded: boolean): Promise<void> {
      if (!session) return;
      if (succeeded) await session.release();
      else await session.destroy();
    },
  };
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

  const browser = jobBrowser(env, job.id);
  let succeeded = false;
  try {
    const { result, eventId } = await runJob(env, job, browser.page);
    await browser.persist();
    await markJobSucceeded(env.DB, job.id, result, eventId);
    succeeded = true;
  } catch (error) {
    const failure = await browser.failure(errorMessage(error));
    await markJobFailed(env.DB, job.id, failure.detail, failure.artifactKey);
    throw error;
  } finally {
    await browser.close(succeeded);
  }
}

async function runJob(
  env: Env,
  job: JobRecord,
  openPage: () => Promise<JobPage>,
): Promise<JobOutcome> {
  if (job.type === "relogin") {
    await forceRelogin(env);
    return { result: { ok: true } };
  }

  if (job.type === "create_event") {
    const request = parseRequest<CreateEventRequest>(job);
    const page = await openPage();
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
  }

  const eventId = job.eventId;
  if (!eventId) throw new Error("event_id_required");

  if (job.type === "update_event") {
    const request = parseRequest<UpdateEventRequest>(job);
    const page = await openPage();
    await page.goto(`https://connpass.com/event/${eventId}/edit/`, {
      waitUntil: "domcontentloaded",
    });
    await fillEventEdit(page, request);
    return {
      eventId,
      result: { eventId, editUrl: `https://connpass.com/event/${eventId}/edit/` },
    };
  }

  if (job.type === "publish_event") {
    const request = parseRequest<PublishEventRequest>(job);
    await publishEvent(await openPage(), eventId, request);
    return { eventId, result: { eventId, publicUrl: `https://connpass.com/event/${eventId}/` } };
  }

  if (job.type === "create_sub_event") {
    const request = parseRequest<CreateSubEventRequest>(job);
    const created = await createSubEventDraft(await openPage(), eventId, request.title);
    return {
      eventId: created.eventId,
      result: {
        eventId: created.eventId,
        editUrl: created.editUrl,
        publicUrl: `https://connpass.com/event/${created.eventId}/`,
      },
    };
  }

  if (job.type === "delete_sub_event") {
    parseRequest<DeleteSubEventRequest>(job);
    await cancelSubEvent(await openPage(), eventId);
    return { eventId, result: { eventId, canceled: true } };
  }

  if (job.type === "upsert_survey") {
    const request = parseRequest<UpsertSurveyRequest>(job);
    await upsertSurvey(await openPage(), eventId, request.questions);
    return { eventId, result: { eventId } };
  }

  if (job.type === "upsert_conference") {
    const request = parseRequest<UpsertConferenceRequest>(job);
    await upsertConference(await openPage(), eventId, request);
    return { eventId, result: { eventId } };
  }

  if (job.type === "upload_event_image") {
    const request = parseRequest<UploadEventImageRequest>(job);
    const page = await openPage();
    const object = await env.ARTIFACTS.get(request.artifactKey);
    if (!object) throw new Error("event_image_missing");
    try {
      await uploadEventImage(
        page,
        eventId,
        new Uint8Array(await object.arrayBuffer()),
        request.contentType,
        request.name,
      );
    } finally {
      await env.ARTIFACTS.delete(request.artifactKey);
    }
    return { eventId, result: { eventId } };
  }

  if (job.type === "copy_event") {
    const copied = await copyEvent(await openPage(), eventId);
    return { eventId: copied.eventId, result: { eventId: copied.eventId } };
  }

  if (job.type === "delete_event_draft") {
    await deleteEventDraft(await openPage(), eventId);
    return { eventId, result: { eventId } };
  }

  if (job.type === "cancel_event") {
    await cancelEvent(await openPage(), eventId);
    return { eventId, result: { eventId } };
  }

  if (job.type === "update_participant") {
    const request = parseRequest<UpdateParticipantRequest>(job);
    await updateParticipant(await openPage(), eventId, request.participantId, request.input);
    return { eventId, result: { eventId, participantId: request.participantId } };
  }

  if (job.type === "send_event_message") {
    const request = parseRequest<EventMessageRequest>(job);
    await sendEventMessage(await openPage(), eventId, request);
    return { eventId, result: { eventId } };
  }

  if (
    job.type === "create_voucher_recipient" ||
    job.type === "update_voucher_recipient" ||
    job.type === "delete_voucher_recipient"
  ) {
    const request = parseRequest<VoucherRequest>(job);
    const page = await openPage();
    if (job.type === "delete_voucher_recipient") {
      if (!request.voucherId) throw new Error("voucher_id_required");
      await deleteVoucherRecipient(page, eventId, request.voucherId);
    } else {
      await saveVoucherRecipient(page, eventId, request.input, request.voucherId);
    }
    return { eventId, result: { eventId, voucherId: request.voucherId } };
  }

  throw new Error(`unknown_job_type:${job.type}`);
}
