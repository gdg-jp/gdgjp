import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainDetection } from "~/lib/domain-detection";
import { getDomainJob } from "./domain-job.repository.server";
import { createDomainRegistrationJob, createDomainSyncJob } from "./domain-job.service.server";
import { fakeJobsDb, fakeProvider, pendingDomainRow } from "./domain-job.test-support";
import type { DomainServiceDependencies } from "./domain.service";
import { VERCEL_HOBBY_DOMAIN_LIMIT } from "./domain.service";

const originalDev = import.meta.env.DEV;
beforeEach(() => {
  // Disable the dev inline-execution fallback by default for these
  // orchestration-only tests; the dedicated describe block below re-enables
  // it to pin the fallback itself (Vite local queue consumers often never
  // fire, so this is what makes local dev testable at all).
  import.meta.env.DEV = false;
});
afterEach(() => {
  import.meta.env.DEV = originalDev;
});

const organizer: AuthUser = {
  id: "u_organizer",
  email: "organizer@example.com",
  name: "Organizer",
  image: null,
  isAdmin: false,
};
const chapter: UserChapter = { chapterId: 1, chapterSlug: "tokyo", role: "organizer" };

const readyDetection: DomainDetection = {
  hostname: "gdg-tokyo.jp",
  mode: "short-only",
  existingSite: false,
  suggestedUpstreamOrigin: null,
  dns: { status: "resolved", observations: [] },
  https: { status: "not-checked", statusCode: null, finalUrl: null },
};

function baseDeps(overrides: Partial<DomainServiceDependencies> = {}): DomainServiceDependencies {
  return {
    db: fakeJobsDb(),
    provider: fakeProvider(),
    detectCustomDomain: async () => readyDetection,
    ...overrides,
  };
}

function fakeEnv(overrides: { send?: () => Promise<void> } = {}): Env {
  return {
    JOB_QUEUE: { send: overrides.send ?? (async () => {}) },
  } as unknown as Env;
}

const noopCtx = { waitUntil: () => {} } as unknown as ExecutionContext;

describe("createDomainRegistrationJob", () => {
  it("rejects a chapter the actor cannot manage", async () => {
    const result = await createDomainRegistrationJob(
      baseDeps(),
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 99 },
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("rejects a non-apex hostname", async () => {
    const result = await createDomainRegistrationJob(
      baseDeps(),
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "not a domain", chapterId: 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects a hostname that resolves unsafely", async () => {
    const deps = baseDeps({
      detectCustomDomain: async () => ({
        ...readyDetection,
        dns: { status: "unsafe", observations: [] },
      }),
    });
    const result = await createDomainRegistrationJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects once the Vercel Hobby project domain limit is reached", async () => {
    const existing = Array.from({ length: VERCEL_HOBBY_DOMAIN_LIMIT }, (_, i) => ({
      ...pendingDomainRow,
      id: i + 1,
      hostname: `existing-${i}.jp`,
      status: "active",
    }));
    const deps = baseDeps({ db: fakeJobsDb(existing) });
    const result = await createDomainRegistrationJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects a hostname that is already registered", async () => {
    const deps = baseDeps({
      db: fakeJobsDb([{ ...pendingDomainRow, hostname: "gdg-tokyo.jp" }]),
    });
    const result = await createDomainRegistrationJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "conflict" });
  });

  it("creates the pending domain and a queued job, returning 202-shaped data", async () => {
    const deps = baseDeps();
    const result = await createDomainRegistrationJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("queued");
    expect(result.job.type).toBe("provision_domain");
    expect(result.job.request).toEqual({ hostname: "gdg-tokyo.jp", chapterId: 1 });
    expect(typeof result.job.domainId).toBe("number");
  });

  it("marks the job failed and returns queue_unavailable when the queue send fails", async () => {
    const deps = baseDeps();
    const env = fakeEnv({
      send: async () => {
        throw new Error("queue down");
      },
    });
    const result = await createDomainRegistrationJob(
      deps,
      env,
      noopCtx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 1 },
    );
    expect(result).toMatchObject({ ok: false, code: "queue_unavailable" });
  });
});

describe("createDomainSyncJob", () => {
  it("returns not_found for a missing domain", async () => {
    const deps = baseDeps();
    const result = await createDomainSyncJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      404,
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("returns forbidden when the actor does not manage the domain's chapter", async () => {
    const deps = baseDeps({ db: fakeJobsDb([{ ...pendingDomainRow, owner_chapter_id: 99 }]) });
    const result = await createDomainSyncJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      5,
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("returns conflict when the domain is already active", async () => {
    const deps = baseDeps({ db: fakeJobsDb([{ ...pendingDomainRow, status: "active" }]) });
    const result = await createDomainSyncJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      5,
    );
    expect(result).toMatchObject({ ok: false, code: "conflict" });
  });

  it("creates a retry job for an existing pending domain", async () => {
    const deps = baseDeps({ db: fakeJobsDb([pendingDomainRow]) });
    const result = await createDomainSyncJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("queued");
    expect(result.job.domainId).toBe(5);
  });

  it("returns conflict instead of a duplicate job when one is already in progress", async () => {
    const deps = baseDeps({ db: fakeJobsDb([pendingDomainRow]) });
    const first = await createDomainSyncJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      5,
    );
    expect(first.ok).toBe(true);

    const second = await createDomainSyncJob(
      deps,
      fakeEnv(),
      noopCtx,
      { user: organizer, chapters: [chapter] },
      5,
    );
    expect(second).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("dev inline-execution fallback", () => {
  it("runs the queued job inline via ctx.waitUntil when import.meta.env.DEV is true", async () => {
    // Vite local queue consumers often never fire in dev, so this fallback
    // is what makes `POST /api/cli/v1/domains` observably progress past
    // "queued" during local testing at all.
    import.meta.env.DEV = true;
    const deps = baseDeps();
    let inlineRun: Promise<unknown> = Promise.resolve();
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        inlineRun = promise;
      },
    } as unknown as ExecutionContext;

    const result = await createDomainRegistrationJob(
      deps,
      fakeEnv(),
      ctx,
      { user: organizer, chapters: [chapter] },
      { hostname: "gdg-tokyo.jp", chapterId: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await inlineRun;
    const finished = await getDomainJob(deps.db, result.job.id);
    expect(finished?.status).toBe("succeeded");
  });
});
