import { describe, expect, it } from "vitest";
import { XAccountError, listUsableXAccounts, revokeXAccount } from "./x-account.service.server";
import type { XAccountDependencies } from "./x-account.types";

type Row = Record<string, unknown>;

function accountRow(over: Row = {}): Row {
  return {
    id: "acc-1",
    chapter_id: 1,
    x_user_id: "x1",
    username: "gdg_tokyo",
    display_name: "GDG Tokyo",
    profile_image_url: null,
    access_token_ciphertext: "enc-access",
    refresh_token_ciphertext: "enc-refresh",
    access_token_expires_at: null,
    authorized_by_user_id: "u1",
    created_at: "t0",
    updated_at: "t0",
    revoked_at: null,
    ...over,
  };
}

function makeDb(seed: Row[] = []) {
  const rows: Row[] = seed.map((row) => ({ ...row }));

  function run(sql: string, b: unknown[]) {
    if (sql.startsWith("UPDATE x_accounts SET revoked_at")) {
      const [revokedAt, updatedAt, id, chapterId, xUserId] = b;
      const row = rows.find(
        (r) => r.id === id && r.chapter_id === chapterId && r.x_user_id === xUserId,
      );
      if (!row) return { meta: { changes: 0 } };
      row.revoked_at = revokedAt;
      row.updated_at = updatedAt;
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  function all(sql: string, b: unknown[]) {
    if (sql.includes("FROM x_accounts WHERE chapter_id = ? AND revoked_at IS NULL")) {
      const [chapterId] = b;
      const results = rows
        .filter((r) => r.chapter_id === chapterId && r.revoked_at === null)
        .sort((x, y) => String(x.username).localeCompare(String(y.username)));
      return { results };
    }
    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  function prepare(sql: string) {
    const stmt = {
      _bound: [] as unknown[],
      bind(...values: unknown[]) {
        stmt._bound = values;
        return stmt;
      },
      run: async () => run(sql, stmt._bound),
      all: async <T>() => all(sql, stmt._bound) as { results: T[] },
      first: async () => null,
    };
    return stmt;
  }

  return { db: { prepare } as unknown as D1Database, rows };
}

function deps(db: D1Database): XAccountDependencies {
  return { db };
}

describe("listUsableXAccounts", () => {
  it("returns active accounts without any encrypted token fields", async () => {
    const { db } = makeDb([accountRow()]);
    const [summary] = await listUsableXAccounts(deps(db), 1);

    expect(summary).toEqual({
      id: "acc-1",
      chapterId: 1,
      xUserId: "x1",
      username: "gdg_tokyo",
      displayName: "GDG Tokyo",
      profileImageUrl: null,
      authorizedByUserId: "u1",
      createdAt: "t0",
      updatedAt: "t0",
      revokedAt: null,
    });
    expect(JSON.stringify(summary)).not.toContain("enc-access");
    expect(JSON.stringify(summary)).not.toContain("enc-refresh");
  });

  it("excludes revoked accounts and accounts from other chapters", async () => {
    const { db } = makeDb([
      accountRow({ id: "acc-1" }),
      accountRow({ id: "acc-2", x_user_id: "x2", revoked_at: "2026-01-01T00:00:00.000Z" }),
      accountRow({ id: "acc-3", x_user_id: "x3", chapter_id: 2 }),
    ]);
    const summaries = await listUsableXAccounts(deps(db), 1);
    expect(summaries.map((s) => s.id)).toEqual(["acc-1"]);
  });
});

describe("revokeXAccount", () => {
  it("soft-revokes the row (keeps it) when chapter and X user id match", async () => {
    const { db, rows } = makeDb([accountRow()]);
    await revokeXAccount(deps(db), "acc-1", 1, "x1");

    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toEqual(expect.any(String));
    expect(rows[0].updated_at).toEqual(rows[0].revoked_at);
  });

  it("rejects a mismatched X user id confirmation and leaves the row active", async () => {
    const { db, rows } = makeDb([accountRow()]);
    await expect(revokeXAccount(deps(db), "acc-1", 1, "wrong")).rejects.toBeInstanceOf(
      XAccountError,
    );
    await expect(revokeXAccount(deps(db), "acc-1", 1, "wrong")).rejects.toThrow(
      "X Account ID confirmation does not match",
    );
    expect(rows[0].revoked_at).toBeNull();
  });

  it("rejects revoking an account owned by another chapter", async () => {
    const { db } = makeDb([accountRow()]);
    await expect(revokeXAccount(deps(db), "acc-1", 99, "x1")).rejects.toBeInstanceOf(XAccountError);
  });
});
