import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { listManagedUsers, revokeUserSessions, setUserAdmin } from "./user-admin.server";

type Call = { sql: string; args: unknown[]; operation: "first" | "all" };

function testDb(
  options: {
    rows?: object[];
    total?: number;
    target?: object | null;
    updateChanges?: number;
  } = {},
) {
  const calls: Call[] = [];
  const preparedSql: string[] = [];
  const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
  const db = {
    prepare(sql: string) {
      preparedSql.push(sql);
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first() {
          calls.push({ sql, args, operation: "first" });
          if (sql.includes("COUNT(*)")) return { total: options.total ?? 0 };
          if (sql.includes('SELECT is_admin FROM "user"')) return options.target ?? null;
          if (sql.includes("SELECT 1 AS ok")) return options.target ?? null;
          return null;
        },
        async all() {
          calls.push({ sql, args, operation: "all" });
          return { results: options.rows ?? [] };
        },
      };
      return statement as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      batches.push(
        statements.map((statement) => {
          const prepared = statement as unknown as { __sql?: string };
          return { sql: prepared.__sql ?? String(statement), args: [] };
        }),
      );
      return statements.map((_, index) => ({
        meta: { changes: index === 0 ? (options.updateChanges ?? 1) : 0 },
      }));
    },
  };

  // Preserve SQL and bindings for D1's otherwise opaque PreparedStatement objects.
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = originalPrepare(sql) as unknown as {
      bind: (...values: unknown[]) => D1PreparedStatement;
      __sql?: string;
    };
    statement.__sql = sql;
    return statement as D1PreparedStatement;
  }) as typeof db.prepare;

  return { db: db as D1Database, calls, preparedSql, batches };
}

describe("listManagedUsers", () => {
  it("returns a searched page with membership and session aggregates", async () => {
    const { db, calls } = testDb({
      total: 31,
      rows: [
        {
          id: "user-1",
          name: "Ada",
          email: "ada@example.com",
          image: null,
          is_admin: 1,
          created_at: 10,
          updated_at: 20,
          email_verified: 1,
          membership_count: 3,
          active_membership_count: 2,
          pending_membership_count: 1,
          session_count: 4,
        },
      ],
    });

    const result = await listManagedUsers(db, { query: "Ada%", page: 2, pageSize: 10 });

    expect(result).toEqual({
      users: [
        expect.objectContaining({
          id: "user-1",
          isAdmin: true,
          membershipCount: 3,
          activeMembershipCount: 2,
          pendingMembershipCount: 1,
          sessionCount: 4,
        }),
      ],
      page: 2,
      pageSize: 10,
      total: 31,
    });
    const listCall = calls.find((call) => call.operation === "all");
    expect(listCall?.sql).toContain('LEFT JOIN "session"');
    expect(listCall?.sql).toContain("COUNT(DISTINCT m.chapter_id)");
    expect(listCall?.args).toEqual(["%Ada\\%%", "%Ada\\%%", 10, 10]);
  });

  it("normalizes invalid pagination and caps page size", async () => {
    const { db, calls } = testDb();
    const result = await listManagedUsers(db, { page: 0, pageSize: 999 });

    expect(result).toMatchObject({ page: 1, pageSize: 100 });
    const listCall = calls.find((call) => call.operation === "all");
    expect(listCall?.args).toEqual([100, 0]);
  });
});

describe("setUserAdmin", () => {
  it("updates the flag and atomically revokes sessions and OAuth tokens", async () => {
    const { db, preparedSql, batches } = testDb();

    await expect(
      setUserAdmin(db, { actorId: "admin-1", targetId: "user-1", isAdmin: false }),
    ).resolves.toEqual({ status: "updated" });

    expect(batches).toHaveLength(1);
    expect(preparedSql.some((sql) => sql.includes('DELETE FROM "oauthAccessToken"'))).toBe(true);
    expect(preparedSql.some((sql) => sql.includes('DELETE FROM "oauthRefreshToken"'))).toBe(true);
    expect(preparedSql.some((sql) => sql.includes('DELETE FROM "session"'))).toBe(true);
  });

  it("reports last_admin without revoking credentials when the guarded update fails", async () => {
    const { db } = testDb({ updateChanges: 0, target: { is_admin: 1 } });

    await expect(
      setUserAdmin(db, { actorId: "admin-1", targetId: "admin-2", isAdmin: false }),
    ).resolves.toEqual({ status: "last_admin" });
  });

  it("reports a missing target", async () => {
    const { db } = testDb({ updateChanges: 0, target: null });

    await expect(
      setUserAdmin(db, { actorId: "admin-1", targetId: "missing", isAdmin: true }),
    ).resolves.toEqual({ status: "not_found" });
  });
});

describe("revokeUserSessions", () => {
  it("does not allow an administrator to revoke their own session", async () => {
    const { db, preparedSql } = testDb();

    await expect(
      revokeUserSessions(db, { actorId: "admin-1", targetId: "admin-1" }),
    ).resolves.toEqual({
      status: "self_revoke",
    });
    expect(preparedSql).toEqual([]);
  });

  it("deletes every session and OAuth token for an existing target", async () => {
    const { db, preparedSql, batches } = testDb({ target: { ok: 1 } });

    await expect(
      revokeUserSessions(db, { actorId: "admin-1", targetId: "user-1" }),
    ).resolves.toEqual({
      status: "revoked",
    });
    expect(batches).toHaveLength(1);
    expect(preparedSql).toContain('DELETE FROM "oauthAccessToken" WHERE "userId" = ?');
    expect(preparedSql).toContain('DELETE FROM "oauthRefreshToken" WHERE "userId" = ?');
    expect(preparedSql).toContain('DELETE FROM "session" WHERE "userId" = ?');
  });
});
