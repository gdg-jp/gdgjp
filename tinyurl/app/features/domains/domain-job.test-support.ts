import type { DomainProvider, ProviderDomainState } from "./domain-provider";

export type Row = Record<string, unknown>;

/**
 * A fake D1Database backing both `domains` and `jobs`, shared by the
 * domain-job repository/service/runner unit tests. SQL matching is
 * substring-based against the exact queries those modules issue.
 */
export function fakeJobsDb(initialDomains: Row[] = [], initialJobs: Row[] = []): D1Database {
  const domains: Row[] = initialDomains.map((r) => ({ ...r }));
  const jobs: Row[] = initialJobs.map((r) => ({ ...r }));
  let nextDomainId = domains.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
  let tick = 0;

  // Backdated by a fixed minute (plus a small monotonic tick to preserve
  // ordering) so it reads as "recent" against a default multi-minute lease
  // cutoff, but "stale" against a zero-length lease used to simulate an
  // expired lease in tests — both cutoffs are derived from the real
  // `Date.now()` by the repository under test.
  function nowIso(): string {
    tick += 1;
    return new Date(Date.now() - 60_000 + tick).toISOString();
  }

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const exec = (): Row[] => {
      if (sql.includes("INSERT INTO domains")) {
        const [hostname, mode, upstreamOrigin, ownerChapterId, createdByUserId] = bound;
        if (
          domains.some((r) => String(r.hostname).toLowerCase() === String(hostname).toLowerCase())
        ) {
          throw new Error("UNIQUE constraint failed: domains.hostname");
        }
        const row: Row = {
          id: nextDomainId++,
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
        domains.push(row);
        return [row];
      }
      if (sql.startsWith("UPDATE domains SET")) {
        const [status, providerDomainId, verificationRecords, providerError, id] = bound;
        const row = domains.find((r) => r.id === id && r.deleted_at === null);
        if (!row) return [];
        row.status = status;
        if (providerDomainId != null) row.provider_domain_id = providerDomainId;
        if (verificationRecords != null) row.verification_records = verificationRecords;
        row.provider_error = providerError;
        return [row];
      }
      if (sql.includes("FROM domains WHERE id = ?")) {
        const [id] = bound;
        const row = domains.find((r) => r.id === id && r.deleted_at === null);
        return row ? [row] : [];
      }
      if (sql.includes("FROM domains") && sql.includes("deleted_at IS NULL AND (")) {
        const chapterIds = bound.map(Number);
        return domains.filter(
          (r) => r.deleted_at === null && chapterIds.includes(Number(r.owner_chapter_id)),
        );
      }
      if (sql.includes("INSERT INTO jobs")) {
        const [id, type, domainId, requestJson, createdBy] = bound;
        const row: Row = {
          id,
          type,
          status: "queued",
          domain_id: domainId,
          request_json: requestJson,
          result_json: null,
          error: null,
          created_by: createdBy,
          created_at: nowIso(),
          updated_at: nowIso(),
          started_at: null,
          finished_at: null,
        };
        jobs.push(row);
        return [row];
      }
      if (sql.includes("FROM jobs WHERE id = ?")) {
        const [id] = bound;
        const row = jobs.find((r) => r.id === id);
        return row ? [row] : [];
      }
      if (sql.includes("FROM jobs") && sql.includes("domain_id = ?") && sql.includes("status IN")) {
        const [domainId] = bound;
        const matches = jobs
          .filter(
            (r) => r.domain_id === domainId && (r.status === "queued" || r.status === "running"),
          )
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return matches.length ? [matches[0]] : [];
      }
      if (sql.startsWith("UPDATE jobs SET status = 'running'")) {
        const [id, cutoff] = bound;
        const row = jobs.find((r) => r.id === id);
        if (!row) return [];
        const eligible =
          row.status === "queued" ||
          (row.status === "running" && String(row.started_at) < String(cutoff));
        if (!eligible) return [];
        row.status = "running";
        row.started_at = nowIso();
        row.updated_at = nowIso();
        return [row];
      }
      if (sql.startsWith("UPDATE jobs SET status = 'succeeded'")) {
        const [resultJson, id] = bound;
        const row = jobs.find((r) => r.id === id);
        if (!row) return [];
        row.status = "succeeded";
        row.result_json = resultJson;
        row.error = null;
        row.finished_at = nowIso();
        row.updated_at = nowIso();
        return [row];
      }
      if (sql.startsWith("UPDATE jobs SET status = 'failed'")) {
        const [error, resultJson, id] = bound;
        const row = jobs.find((r) => r.id === id);
        if (!row) return [];
        row.status = "failed";
        row.error = error;
        if (resultJson != null) row.result_json = resultJson;
        row.finished_at = nowIso();
        row.updated_at = nowIso();
        return [row];
      }
      throw new Error(`Unhandled SQL in fake jobs db: ${sql}`);
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
        const result = exec();
        return { meta: { changes: result.length } };
      },
    };
  }

  return { prepare } as unknown as D1Database;
}

export function fakeProvider(overrides: Partial<DomainProvider> = {}): DomainProvider {
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

export const pendingDomainRow: Row = {
  id: 5,
  hostname: "gdg-osaka.jp",
  kind: "custom",
  mode: "short-only",
  upstream_origin: null,
  owner_chapter_id: 1,
  status: "pending",
  provider_domain_id: null,
  verification_records: "[]",
  provider_error: null,
  created_by_user_id: "u_organizer",
  created_at: 0,
  updated_at: 0,
  checked_at: null,
  deleted_at: null,
};
