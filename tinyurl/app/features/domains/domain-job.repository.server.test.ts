import { describe, expect, it } from "vitest";
import {
  getDomainJob,
  getLatestNonTerminalJobForDomain,
  insertDomainJob,
  markDomainJobFailed,
  markDomainJobRunning,
  markDomainJobSucceeded,
} from "./domain-job.repository.server";
import { fakeJobsDb, pendingDomainRow } from "./domain-job.test-support";

describe("insertDomainJob / getDomainJob", () => {
  it("creates a queued job and reads it back", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: { hostname: "gdg-osaka.jp", chapterId: 1 },
      createdBy: "u_organizer",
    });
    expect(job.status).toBe("queued");
    expect(job.domainId).toBe(5);
    expect(job.requestJson).toBe('{"hostname":"gdg-osaka.jp","chapterId":1}');

    const fetched = await getDomainJob(db, job.id);
    expect(fetched).toEqual(job);
  });

  it("returns null for an unknown job id", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    expect(await getDomainJob(db, "does-not-exist")).toBeNull();
  });
});

describe("getLatestNonTerminalJobForDomain", () => {
  it("returns null when no job exists for the domain", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    expect(await getLatestNonTerminalJobForDomain(db, 5)).toBeNull();
  });

  it("ignores terminal jobs", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobSucceeded(db, job.id, { ok: true });
    expect(await getLatestNonTerminalJobForDomain(db, 5)).toBeNull();
  });

  it("finds a queued or running job for the domain", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    const found = await getLatestNonTerminalJobForDomain(db, 5);
    expect(found?.id).toBe(job.id);
  });
});

describe("markDomainJobRunning", () => {
  it("claims a queued job", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    expect(await markDomainJobRunning(db, job.id)).toBe(true);
    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("running");
    expect(updated?.startedAt).not.toBeNull();
  });

  it("refuses to claim a job that is already running within its lease", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    expect(await markDomainJobRunning(db, job.id)).toBe(true);
    expect(await markDomainJobRunning(db, job.id)).toBe(false);
  });

  it("reclaims a running job once its lease has expired", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    expect(await markDomainJobRunning(db, job.id, 5_000)).toBe(true);
    // Lease of 0ms means "started before now" is always stale.
    expect(await markDomainJobRunning(db, job.id, 0)).toBe(true);
  });

  it("does not claim a terminal job", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobSucceeded(db, job.id, { ok: true });
    expect(await markDomainJobRunning(db, job.id)).toBe(false);
  });
});

describe("markDomainJobSucceeded / markDomainJobFailed", () => {
  it("persists the result and clears any prior error on success", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobSucceeded(db, job.id, { status: "active" });
    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("succeeded");
    expect(updated?.resultJson).toBe('{"status":"active"}');
    expect(updated?.error).toBeNull();
    expect(updated?.finishedAt).not.toBeNull();
  });

  it("persists both the error and the error-state result on failure", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobFailed(db, job.id, "Vercel is down", { status: "error" });
    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("Vercel is down");
    expect(updated?.resultJson).toBe('{"status":"error"}');
  });

  it("marks failed without a result when none is given (queue-send failure)", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobFailed(db, job.id, "Queue send failed");
    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("Queue send failed");
    expect(updated?.resultJson).toBeNull();
  });
});
