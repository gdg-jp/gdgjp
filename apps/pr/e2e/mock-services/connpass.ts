// Local stand-in for gdgjp-connpass's PrService (vite.config.ts auxiliaryWorkers, dev only).
// Groups belong to the chapter in their name ("group-<chapterId>"); organizers write.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { ConnpassJobSummary, PrActor } from "@gdgjp/gdg-lib";

const jobs = new Map<string, ConnpassJobSummary & { request: unknown; actor: string }>();
// Ids stay unique across dev-server restarts (pr keeps them in D1).
const RUN = Date.now().toString(36);

const chapterOf = (groupSlug: string) => Number(groupSlug.split("-").at(-1));
const canWrite = (actor: PrActor, groupSlug: string) =>
  actor.user.isAdmin ||
  actor.chapters.some((c) => c.chapterId === chapterOf(groupSlug) && c.role === "organizer");

function submit(
  input: { actor: PrActor; groupSlug: string; eventId?: string },
  type: string,
  request: unknown,
) {
  if (!canWrite(input.actor, input.groupSlug)) return { ok: false as const, code: "forbidden" };
  const id = `cjob-${RUN}-${jobs.size + 1}`;
  const job = {
    id,
    type,
    status: "queued" as const,
    groupId: input.groupSlug,
    eventId: input.eventId ?? null,
    result: null,
    error: null,
  };
  jobs.set(id, { ...job, request, actor: input.actor.user.id });
  return { ok: true as const, job };
}

export class PrService extends WorkerEntrypoint {
  checkGroup({ actor, groupSlug }: { actor: PrActor; groupSlug: string }) {
    const read = actor.chapters.some((c) => c.chapterId === chapterOf(groupSlug));
    return read
      ? {
          ok: true as const,
          write: canWrite(actor, groupSlug),
          chapterId: String(chapterOf(groupSlug)),
        }
      : { ok: false as const, code: "forbidden" };
  }
  updateEvent(input: { actor: PrActor; groupSlug: string; eventId: string; fields: unknown }) {
    return submit(input, "update_event", input.fields);
  }
  publishEvent(input: { actor: PrActor; groupSlug: string; eventId: string }) {
    return submit(input, "publish_event", {});
  }
  uploadImage(input: {
    actor: PrActor;
    groupSlug: string;
    eventId: string;
    bytes: ArrayBuffer;
    contentType: string;
  }) {
    if (input.bytes.byteLength > 1024 * 1024)
      return { ok: false as const, code: "invalid_event_image" };
    return submit(input, "upload_event_image", {
      bytes: input.bytes.byteLength,
      contentType: input.contentType,
    });
  }
  upsertSurvey(input: { actor: PrActor; groupSlug: string; eventId: string; questions: unknown }) {
    return submit(input, "upsert_survey", { questions: input.questions });
  }
  sendMessage(input: {
    actor: PrActor;
    groupSlug: string;
    eventId: string;
    subject: string;
    body: string;
  }) {
    return submit(input, "send_event_message", { subject: input.subject, body: input.body });
  }
  sendGroupMessage() {
    return { ok: false as const, code: "not_supported" };
  }
  createSubEvent(input: { actor: PrActor; groupSlug: string; eventId: string; title: string }) {
    return submit(input, "create_sub_event", { title: input.title });
  }
  createListing(input: { actor: PrActor; platform: string; targetId: string; listing: unknown }) {
    // The real connpass app answers not_supported until a method is chosen per platform.
    if (input.platform === "luma")
      return submit({ actor: input.actor, groupSlug: "group-1" }, "create_listing", input.listing);
    return { ok: false as const, code: "not_supported" };
  }
  getJob({ jobId }: { jobId: string }) {
    const job = jobs.get(jobId);
    if (!job) return { ok: false as const, code: "not_found" };
    const { request: _r, actor: _a, ...summary } = job;
    return { ok: true as const, job: summary };
  }
  getStats() {
    return {
      ok: true as const,
      statistics: {
        registeredCount: 312,
        waitlistedCount: 4,
        canceledCount: 10,
        checkedInCount: 0,
      },
    };
  }
  listParticipants() {
    return { ok: true as const, participants: [] };
  }
  // Test hooks (reached through pr's /dev/mock-services).
  mockState() {
    return { jobs: [...jobs.values()] };
  }
  mockFinish(jobId: string) {
    const job = jobs.get(jobId);
    if (job) job.status = "succeeded";
    return !!job;
  }
}

export default { fetch: () => new Response("mock gdgjp-connpass") };
