import type { PrActor } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const group = vi.fn();
const createJob = vi.fn();
vi.mock("~/features/auth/rpc-access.server", () => ({
  groupForPrActor: (...a: unknown[]) => group(...a),
}));
vi.mock("./job-submission.server", () => ({ createJob: (...a: unknown[]) => createJob(...a) }));
vi.mock("~/features/connpass/connpass-browser-read.server", () => ({}));

const { prSendMessage, prUpdateEvent, prUploadImage } = await import("./pr-service.server");

const actor: PrActor = {
  user: { id: "u1", email: "u@example.com", name: "u", image: null, isAdmin: false },
  chapters: [{ chapterId: 1, chapterSlug: "kwansai", role: "organizer" }],
};
const job = {
  id: "j1",
  type: "update_event",
  status: "queued",
  groupSlug: "gdgkwansai",
  eventId: "1",
  requestJson: '{"description":"x"}',
  resultJson: null,
  error: null,
  artifactKey: null,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  startedAt: null,
  finishedAt: null,
};
const env = { DB: {}, ARTIFACTS: { put: vi.fn() } } as unknown as Env;
const target = { actor, groupSlug: "gdgkwansai", eventId: "1" };

beforeEach(() => {
  group.mockReset();
  createJob.mockReset();
});

describe("connpass PrService", () => {
  it("writes only through a job, as the actor, for an allowed group", async () => {
    group.mockResolvedValue({ groupSlug: "gdgkwansai", chapterId: "1", enabled: true });
    createJob.mockResolvedValue(job);
    const result = await prUpdateEvent(env, undefined, { ...target, fields: { description: "x" } });
    expect(result).toMatchObject({ ok: true, job: { id: "j1", status: "queued" } });
    expect(createJob.mock.calls[0][1]).toMatchObject({ type: "update_event", createdBy: "u1" });
  });
  it("refuses a group the actor may not write", async () => {
    group.mockResolvedValue(null);
    expect(
      await prSendMessage(env, undefined, { ...target, subject: "s", body: "b" }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(createJob).not.toHaveBeenCalled();
  });
  it("refuses images over 1 MB before storing them", async () => {
    group.mockResolvedValue({ groupSlug: "gdgkwansai", chapterId: "1", enabled: true });
    const bytes = new ArrayBuffer(1024 * 1024 + 1);
    expect(
      await prUploadImage(env, undefined, {
        ...target,
        bytes,
        contentType: "image/png",
        name: "a.png",
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid_event_image",
    });
  });
});
