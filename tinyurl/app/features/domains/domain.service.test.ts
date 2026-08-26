import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import type { DomainDetection } from "~/lib/domain-detection";
import type { DomainProvider, ProviderDomainState } from "./domain-provider";
import {
  type DomainServiceDependencies,
  VERCEL_HOBBY_DOMAIN_LIMIT,
  registerDomain,
  syncDomain,
} from "./domain.service";

type Row = Record<string, unknown>;

function fakeDomainsDb(initial: Row[] = []): D1Database {
  const rows: Row[] = initial.map((r) => ({ ...r }));
  let nextId = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const exec = (): Row[] => {
      if (sql.includes("INSERT INTO domains")) {
        const [hostname, mode, upstreamOrigin, ownerChapterId, createdByUserId] = bound;
        if (rows.some((r) => String(r.hostname).toLowerCase() === String(hostname).toLowerCase())) {
          throw new Error("UNIQUE constraint failed: domains.hostname");
        }
        const row: Row = {
          id: nextId++,
          hostname,
          kind: "custom",
          mode,
          upstream_origin: upstreamOrigin,
          owner_chapter_id: ownerChapterId,
          status: "pending",
          provider_domain_id: null,
          verification_records: "[]",
          provider_error: null,
          created_by_user_id: createdByUserId,
          created_at: 0,
          updated_at: 0,
          checked_at: null,
          deleted_at: null,
        };
        rows.push(row);
        return [row];
      }
      if (sql.startsWith("UPDATE domains SET")) {
        const [status, providerDomainId, verificationRecords, providerError, id] = bound;
        const row = rows.find((r) => r.id === id && r.deleted_at === null);
        if (!row) return [];
        row.status = status;
        if (providerDomainId != null) row.provider_domain_id = providerDomainId;
        if (verificationRecords != null) row.verification_records = verificationRecords;
        row.provider_error = providerError;
        return [row];
      }
      if (sql.includes("FROM domains WHERE id = ?")) {
        const [id] = bound;
        const row = rows.find((r) => r.id === id && r.deleted_at === null);
        return row ? [row] : [];
      }
      if (sql.includes("FROM domains") && sql.includes("deleted_at IS NULL AND (")) {
        const chapterIds = bound.map(Number);
        return rows.filter(
          (r) => r.deleted_at === null && chapterIds.includes(Number(r.owner_chapter_id)),
        );
      }
      throw new Error(`Unhandled SQL in fake domains db: ${sql}`);
    };
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        const result = exec();
        return (result[0] as T) ?? null;
      },
      async all<T>() {
        return { results: exec() as T[] };
      },
      async run() {
        exec();
        return { meta: { changes: 1 } };
      },
    };
  }

  return { prepare } as unknown as D1Database;
}

function fakeProvider(overrides: Partial<DomainProvider> = {}): DomainProvider {
  const okState: ProviderDomainState = {
    providerDomainId: "example.jp",
    verified: true,
    configured: true,
    records: [],
    error: null,
  };
  return {
    create: async () => okState,
    check: async () => okState,
    verify: async () => okState,
    remove: async () => {},
    ...overrides,
  };
}

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

const unsafeDetection: DomainDetection = {
  ...readyDetection,
  dns: { status: "unsafe", observations: [] },
};

function baseDeps(overrides: Partial<DomainServiceDependencies> = {}): DomainServiceDependencies {
  return {
    db: fakeDomainsDb(),
    provider: fakeProvider(),
    detectCustomDomain: async () => readyDetection,
    ...overrides,
  };
}

describe("registerDomain", () => {
  it("rejects a non-apex hostname", async () => {
    const result = await registerDomain(
      baseDeps(),
      { user: organizer, chapters: [chapter] },
      {
        hostname: "not a domain",
        chapterId: 1,
      },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects a hostname that resolves unsafely", async () => {
    const deps = baseDeps({ detectCustomDomain: async () => unsafeDetection });
    const result = await registerDomain(
      deps,
      { user: organizer, chapters: [chapter] },
      {
        hostname: "gdg-tokyo.jp",
        chapterId: 1,
      },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects when the chapter is not manageable by the actor", async () => {
    const result = await registerDomain(
      baseDeps(),
      { user: organizer, chapters: [chapter] },
      {
        hostname: "gdg-tokyo.jp",
        chapterId: 99,
      },
    );
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("rejects once the Vercel Hobby project domain limit is reached", async () => {
    const existing = Array.from({ length: VERCEL_HOBBY_DOMAIN_LIMIT }, (_, i) => ({
      id: i + 1,
      hostname: `existing-${i}.jp`,
      kind: "custom",
      mode: "short-only",
      upstream_origin: null,
      owner_chapter_id: 1,
      status: "active",
      provider_domain_id: null,
      verification_records: "[]",
      provider_error: null,
      created_by_user_id: null,
      created_at: 0,
      updated_at: 0,
      checked_at: null,
      deleted_at: null,
    }));
    const deps = baseDeps({ db: fakeDomainsDb(existing) });
    const result = await registerDomain(
      deps,
      { user: organizer, chapters: [chapter] },
      {
        hostname: "gdg-tokyo.jp",
        chapterId: 1,
      },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("registers and activates a domain when the provider succeeds", async () => {
    const deps = baseDeps();
    const result = await registerDomain(
      deps,
      { user: organizer, chapters: [chapter] },
      {
        hostname: "gdg-tokyo.jp",
        chapterId: 1,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.domain.hostname).toBe("gdg-tokyo.jp");
      expect(result.domain.status).toBe("active");
    }
  });

  it("still creates the domain, marked as errored, when the provider fails", async () => {
    const deps = baseDeps({
      provider: fakeProvider({
        create: async () => {
          throw new Error("Vercel is down");
        },
      }),
    });
    const result = await registerDomain(
      deps,
      { user: organizer, chapters: [chapter] },
      {
        hostname: "gdg-tokyo.jp",
        chapterId: 1,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.domain.status).toBe("error");
      expect(result.domain.providerError).toBe("Vercel is down");
    }
  });
});

describe("syncDomain", () => {
  const existingDomain: Row = {
    id: 5,
    hostname: "gdg-osaka.jp",
    kind: "custom",
    mode: "short-only",
    upstream_origin: null,
    owner_chapter_id: 1,
    status: "verifying",
    provider_domain_id: null,
    verification_records: "[]",
    provider_error: null,
    created_by_user_id: null,
    created_at: 0,
    updated_at: 0,
    checked_at: null,
    deleted_at: null,
  };

  it("activates the domain once the provider reports it verified and configured", async () => {
    const deps = baseDeps({ db: fakeDomainsDb([existingDomain]) });
    const result = await syncDomain(deps, 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.domain.status).toBe("active");
  });

  it("marks the domain errored when every provider call fails", async () => {
    const deps = baseDeps({
      db: fakeDomainsDb([existingDomain]),
      provider: fakeProvider({
        check: async () => {
          throw new Error("network unreachable");
        },
      }),
    });
    const result = await syncDomain(deps, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network unreachable");
      expect(result.domain.status).toBe("error");
    }
  });
});
