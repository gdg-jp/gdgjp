import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import {
  listManagedUsers,
  revokeUserSessions,
  setUserAdmin,
  setUserChapters,
} from "~/features/users/user-admin.server";

type Call = { sql: string; args: unknown[]; operation: "first" | "all" };

function testDb(
  options: {
    rows?: object[];
    total?: number;
    target?: object | null;
    chapter?: object | null;
    chapters?: object[];
    lastOrganizer?: object | null;
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
          if (sql.includes("FROM chapters WHERE id")) return options.chapter ?? null;
          if (sql.includes("FROM memberships AS m")) return options.lastOrganizer ?? null;
          if (sql.includes("SELECT 1 AS ok")) return options.target ?? null;
          return null;
        },
        async all() {
          calls.push({ sql, args, operation: "all" });
          if (sql.includes("FROM chapters WHERE id IN")) {
            return { results: options.chapters ?? [] };
          }
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

function migratedDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  type Statement = { sql: string; params: SQLInputValue[] };
  const run = ({ sql, params }: Statement) => raw.prepare(sql).all(...params);
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    sql,
    params,
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => run({ sql, params })[0] ?? null,
    all: async () => ({ results: run({ sql, params }) }),
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Statement[]) {
      raw.exec("BEGIN");
      try {
        const results = statements.map(({ sql, params }) => {
          const prepared = raw.prepare(sql);
          if (prepared.columns().length > 0) return { results: prepared.all(...params) };
          return { results: [], meta: { changes: Number(prepared.run(...params).changes) } };
        });
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { raw, db: db as unknown as D1Database };
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

describe("admin revocation and developer-client grants", () => {
  function seedGrant() {
    const { raw, db } = migratedDb();
    raw.exec(`INSERT INTO "user" (id, name, email, is_admin) VALUES
      ('owner', 'Owner', 'owner@example.com', 0),
      ('user-1', 'User', 'user@example.com', 0),
      ('admin-1', 'Admin', 'admin@example.com', 1)`);
    raw.exec(`INSERT INTO "oauthClient" (id, "clientId", "redirectUris", "userId") VALUES
      ('c1', 'dev-app', '[]', 'owner')`);
    raw.exec(`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
      VALUES ('consent', 'dev-app', 'user-1', '[]', '2026-11-01', '2026-11-01')`);
    raw.exec(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES ('code', 'code', '{"type":"authorization_code","query":{"client_id":"dev-app"},"userId":"user-1"}',
        '2999-01-01', '2026-11-01', '2026-11-01')`);
    raw.exec(`DELETE FROM "verification" WHERE id = 'code'`);
    raw.exec(`INSERT INTO "oauthRefreshToken"
      (id, token, "clientId", "userId", "expiresAt", "createdAt", scopes, "authorizationCodeId")
      VALUES ('r1', 't1', 'dev-app', 'user-1', '2999-01-01', '2026-11-01', '[]', 'code')`);
    const counts = () => ({
      consent: raw.prepare(`SELECT id FROM "oauthConsent"`).all().length,
      refresh: raw.prepare(`SELECT id FROM "oauthRefreshToken"`).all().length,
    });
    return { db, counts };
  }

  it("revoking a user's sessions revokes their developer-client consent", async () => {
    const { db, counts } = seedGrant();

    await revokeUserSessions(db, { actorId: "admin-1", targetId: "user-1" });

    expect(counts()).toEqual({ consent: 0, refresh: 0 });
  });

  it("changing a user's admin flag resets their tokens but keeps their consent", async () => {
    const { db, counts } = seedGrant();

    await expect(
      setUserAdmin(db, { actorId: "admin-1", targetId: "user-1", isAdmin: true }),
    ).resolves.toEqual({ status: "updated" });

    expect(counts()).toEqual({ consent: 1, refresh: 0 });
  });
});

describe("setUserChapters", () => {
  it("activates every selected chapter before replacing unselected memberships", async () => {
    const { db, preparedSql, batches } = testDb({
      target: { ok: 1 },
      chapters: [{ id: 2 }, { id: 3 }],
    });

    await expect(setUserChapters(db, { targetId: "user-1", chapterIds: [2, 3] })).resolves.toEqual({
      status: "updated",
    });

    expect(batches).toHaveLength(1);
    expect(preparedSql.some((sql) => sql.includes("ON CONFLICT(user_id, chapter_id)"))).toBe(true);
    expect(
      preparedSql.some((sql) => sql.includes("DELETE FROM memberships WHERE user_id = ?")),
    ).toBe(true);
  });

  it("keeps the user's developer clients enabled when moving them to another chapter", async () => {
    const { raw, db } = migratedDb();
    raw.exec(`INSERT INTO chapters (id, slug, name, kind) VALUES
      (1, 'tokyo', 'Tokyo', 'gdg'), (2, 'osaka', 'Osaka', 'gdg')`);
    raw.exec(`INSERT INTO "user" (id, name, email) VALUES ('user-1', 'User', 'user@example.com')`);
    raw.exec(`INSERT INTO memberships (user_id, chapter_id, role, status)
      VALUES ('user-1', 1, 'member', 'active')`);
    raw.exec(`INSERT INTO "oauthClient" (id, "clientId", "redirectUris", "userId", disabled)
      VALUES ('client-1', 'dev-app', '[]', 'user-1', 0)`);

    await expect(setUserChapters(db, { targetId: "user-1", chapterIds: [2] })).resolves.toEqual({
      status: "updated",
    });

    expect(raw.prepare("SELECT chapter_id, status FROM memberships").all()).toEqual([
      { chapter_id: 2, status: "active" },
    ]);
    expect(raw.prepare(`SELECT disabled FROM "oauthClient" WHERE id = 'client-1'`).get()).toEqual({
      disabled: 0,
    });
  });

  it("does not remove the final active organizer from an unselected chapter", async () => {
    const { db, batches } = testDb({
      target: { ok: 1 },
      chapters: [{ id: 2 }],
      lastOrganizer: { ok: 1 },
    });

    await expect(setUserChapters(db, { targetId: "user-1", chapterIds: [2] })).resolves.toEqual({
      status: "last_active_organizer",
    });
    expect(batches).toEqual([]);
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
