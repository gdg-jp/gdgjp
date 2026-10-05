import { beforeEach, expect, it, vi } from "vitest";
import type { JobRecord } from "./job-types";

const repository = vi.hoisted(() => ({
  getJob: vi.fn(),
  markJobRunning: vi.fn(),
  markJobSucceeded: vi.fn(),
  markJobFailed: vi.fn(),
}));
const browser = vi.hoisted(() => ({
  openConnpassSession: vi.fn(),
  ensureLoggedIn: vi.fn(),
  forceRelogin: vi.fn(),
  tryGetLiveViewUrl: vi.fn(),
  captureFailureArtifact: vi.fn(),
}));
const writes = vi.hoisted(() => ({
  createEventDraft: vi.fn(),
  fillEventEdit: vi.fn(),
  publishEvent: vi.fn(),
}));
vi.mock("./job-repository.server", () => repository);
vi.mock("../connpass/browser.server", () => browser);
vi.mock("../connpass/ui/event-write", () => writes);

import { processJobMessage } from "./job-runner.server";

const job: JobRecord = {
  id: "job-1",
  type: "create_event",
  status: "queued",
  groupSlug: "gdg-tokyo",
  eventId: null,
  requestJson: JSON.stringify({ title: "GDG" }),
  resultJson: null,
  error: null,
  artifactKey: null,
  createdBy: "user-1",
  createdAt: "2026-10-05",
  updatedAt: "2026-10-05",
  startedAt: null,
  finishedAt: null,
};
const env = { DB: {} } as Env;
const ctx = {} as ExecutionContext;
const session = { page: {}, persist: vi.fn(), release: vi.fn(), destroy: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  repository.getJob.mockResolvedValue(job);
  repository.markJobRunning.mockResolvedValue(true);
  browser.openConnpassSession.mockResolvedValue(session);
  browser.tryGetLiveViewUrl.mockResolvedValue(null);
  browser.captureFailureArtifact.mockResolvedValue("failure.png");
  writes.createEventDraft.mockResolvedValue({
    eventId: "42",
    editUrl: "https://connpass.com/event/42/edit/",
  });
  writes.fillEventEdit.mockResolvedValue(undefined);
});

it("does not execute a terminal or already claimed job", async () => {
  repository.getJob.mockResolvedValueOnce({ ...job, status: "succeeded" });
  await processJobMessage(env, ctx, { jobId: job.id });
  expect(repository.markJobRunning).not.toHaveBeenCalled();
  repository.markJobRunning.mockResolvedValueOnce(false);
  await processJobMessage(env, ctx, { jobId: job.id });
  expect(browser.openConnpassSession).not.toHaveBeenCalled();
});

it("persists successful writes before marking success and releasing the warm session", async () => {
  await processJobMessage(env, ctx, { jobId: job.id });
  expect(writes.createEventDraft).toHaveBeenCalledWith(session.page, "gdg-tokyo", "GDG");
  expect(repository.markJobSucceeded).toHaveBeenCalledWith(
    env.DB,
    job.id,
    {
      eventId: "42",
      editUrl: "https://connpass.com/event/42/edit/",
      publicUrl: "https://connpass.com/event/42/",
    },
    "42",
  );
  expect(session.persist.mock.invocationCallOrder[0]).toBeLessThan(
    repository.markJobSucceeded.mock.invocationCallOrder[0],
  );
  expect(repository.markJobSucceeded.mock.invocationCallOrder[0]).toBeLessThan(
    session.release.mock.invocationCallOrder[0],
  );
  expect(session.destroy).not.toHaveBeenCalled();
});

it("captures failure before destroying the session and rethrows for queue retry", async () => {
  const failure = new Error("widget_failed");
  writes.fillEventEdit.mockRejectedValueOnce(failure);
  await expect(processJobMessage(env, ctx, { jobId: job.id })).rejects.toBe(failure);
  expect(repository.markJobFailed).toHaveBeenCalledWith(
    env.DB,
    job.id,
    "widget_failed",
    "failure.png",
  );
  expect(browser.captureFailureArtifact.mock.invocationCallOrder[0]).toBeLessThan(
    session.destroy.mock.invocationCallOrder[0],
  );
  expect(session.release).not.toHaveBeenCalled();
});
