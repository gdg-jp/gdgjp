import { describe, expect, it, vi } from "vitest";
import {
  type DomainJobQueueMessageHandle,
  processDomainJobMessage,
  processDomainJobQueueBatch,
} from "./domain-job-runner.server";
import {
  getDomainJob,
  insertDomainJob,
  markDomainJobRunning,
  markDomainJobSucceeded,
} from "./domain-job.repository.server";
import { type Row, fakeJobsDb, fakeProvider, pendingDomainRow } from "./domain-job.test-support";
import type { DomainServiceDependencies } from "./domain.service";

function baseDeps(
  db: ReturnType<typeof fakeJobsDb>,
  overrides: Partial<DomainServiceDependencies> = {},
): DomainServiceDependencies {
  return {
    db,
    provider: fakeProvider(),
    detectCustomDomain: async () => {
      throw new Error("not used by syncDomain");
    },
    ...overrides,
  };
}

describe("processDomainJobMessage", () => {
  it("is a no-op when the job does not exist", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    await expect(processDomainJobMessage(baseDeps(db), { jobId: "missing" })).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("is a no-op on redelivery of an already-terminal job", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    let providerCalled = false;
    const deps = baseDeps(db, {
      provider: fakeProvider({
        check: async () => {
          providerCalled = true;
          throw new Error("should not be called");
        },
      }),
    });
    // Force the job straight to a terminal state without going through the runner.
    await markDomainJobRunning(db, job.id);
    await markDomainJobSucceeded(db, job.id, { status: "active" });

    await expect(processDomainJobMessage(deps, { jobId: job.id })).resolves.toEqual({
      outcome: "already_terminal",
    });
    expect(providerCalled).toBe(false);
  });

  it("marks the job succeeded when syncDomain reports ok", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    const deps = baseDeps(db, { provider: fakeProvider() });

    await expect(processDomainJobMessage(deps, { jobId: job.id })).resolves.toEqual({
      outcome: "handled",
    });

    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("succeeded");
    expect(updated?.error).toBeNull();
    expect(JSON.parse(updated?.resultJson ?? "null")).toMatchObject({ status: "active" });
  });

  it("marks the job failed, with the error-state domain as the result, when syncDomain reports not ok", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    const deps = baseDeps(db, {
      provider: fakeProvider({
        check: async () => {
          throw new Error("Vercel is down");
        },
        create: async () => {
          throw new Error("Vercel is down");
        },
      }),
    });

    await expect(processDomainJobMessage(deps, { jobId: job.id })).resolves.toEqual({
      outcome: "handled",
    });

    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("Vercel is down");
    expect(JSON.parse(updated?.resultJson ?? "null")).toMatchObject({ status: "error" });
  });

  it("does not run, but reports lease_active with a positive delay, for a job already running within its lease", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobRunning(db, job.id);
    let providerCalled = false;
    const deps = baseDeps(db, {
      provider: fakeProvider({
        check: async () => {
          providerCalled = true;
          throw new Error("should not be called");
        },
      }),
    });

    const result = await processDomainJobMessage(deps, { jobId: job.id });
    expect(result.outcome).toBe("lease_active");
    if (result.outcome === "lease_active") {
      expect(result.retryDelaySeconds).toBeGreaterThan(0);
      // Comfortably under the ~5 minute default lease, since the job was
      // just claimed a moment ago in this test.
      expect(result.retryDelaySeconds).toBeLessThanOrEqual(300);
    }
    expect(providerCalled).toBe(false);
    const updated = await getDomainJob(db, job.id);
    expect(updated?.status).toBe("running");
  });

  it("reclaims and completes a running job whose lease has expired (crashed worker recovery)", async () => {
    // Simulate a worker that claimed the job and then crashed 10 minutes
    // ago, well past the runner's default lease — inserted directly as
    // already "running" rather than via markDomainJobRunning, so the
    // reclaim below exercises the runner's own default lease constant.
    const staleStartedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const staleRunningJob: Row = {
      id: "job-stale",
      type: "provision_domain",
      status: "running",
      domain_id: 5,
      request_json: "{}",
      result_json: null,
      error: null,
      created_by: "u_organizer",
      created_at: staleStartedAt,
      updated_at: staleStartedAt,
      started_at: staleStartedAt,
      finished_at: null,
    };
    const db = fakeJobsDb([pendingDomainRow], [staleRunningJob]);
    const deps = baseDeps(db, { provider: fakeProvider() });

    await expect(processDomainJobMessage(deps, { jobId: "job-stale" })).resolves.toEqual({
      outcome: "handled",
    });

    const updated = await getDomainJob(db, "job-stale");
    expect(updated?.status).toBe("succeeded");
  });
});

function fakeMessage(body: { jobId: string }) {
  return {
    body,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: { delaySeconds?: number }) => void>(),
  } satisfies DomainJobQueueMessageHandle;
}

describe("processDomainJobQueueBatch (the actual queue-handler flow)", () => {
  it("acks a message whose job completes", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    const deps = baseDeps(db, { provider: fakeProvider() });
    const message = fakeMessage({ jobId: job.id });

    await processDomainJobQueueBatch(deps, [message]);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("acks a message for a not-found or already-terminal job (nothing left to do)", async () => {
    const db = fakeJobsDb([pendingDomainRow]);
    const deps = baseDeps(db);
    const message = fakeMessage({ jobId: "missing" });

    await processDomainJobQueueBatch(deps, [message]);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries with a delay — rather than acking — a message whose job is running within another delivery's lease", async () => {
    // This is the crashed-worker-recovery path: without an explicit delayed
    // retry here, no future delivery would ever arrive to reclaim a job
    // whose original claimant crashed, leaving it stuck in "running" forever.
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 5,
      request: {},
      createdBy: "u_organizer",
    });
    await markDomainJobRunning(db, job.id);
    const deps = baseDeps(db, { provider: fakeProvider() });
    const message = fakeMessage({ jobId: job.id });

    await processDomainJobQueueBatch(deps, [message]);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledOnce();
    const [options] = message.retry.mock.calls[0] as [{ delaySeconds: number }];
    expect(options.delaySeconds).toBeGreaterThan(0);
  });

  it("retries immediately (no delay) when processing throws unexpectedly", async () => {
    // syncDomain itself catches every provider error and resolves { ok: false }
    // rather than throwing, so to exercise the batch handler's catch/retry
    // path we need processDomainJobMessage to throw for a different reason:
    // a job whose domain_id doesn't resolve to any row (syncDomain throws
    // synchronously in that case).
    const db = fakeJobsDb([pendingDomainRow]);
    const job = await insertDomainJob(db, {
      type: "provision_domain",
      domainId: 999,
      request: {},
      createdBy: "u_organizer",
    });
    const deps = baseDeps(db, { provider: fakeProvider() });
    const message = fakeMessage({ jobId: job.id });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await processDomainJobQueueBatch(deps, [message]);

    consoleError.mockRestore();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith();
  });
});
