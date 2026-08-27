import { describe, expect, it } from "vitest";
import {
  addContributor,
  listChapterContributors,
  removeContributor,
} from "./contributor.service.server";
import type { ContributorDependencies } from "./contributor.types";

type Row = {
  chapter_id: number;
  user_email: string;
  granted_by_user_id: string;
  created_at: string;
};

/**
 * Minimal `sns_contributors` fake: composite key `(chapter_id, user_email)` with
 * the column's `COLLATE NOCASE` comparison, so `ON CONFLICT ... DO NOTHING` and
 * the `WHERE user_email = ?` lookups behave like D1.
 */
function makeDb(seed: Row[] = []) {
  const rows: Row[] = seed.map((row) => ({ ...row }));
  const sameKey = (a: Row, chapterId: number, email: string) =>
    a.chapter_id === chapterId && a.user_email.toLowerCase() === email.toLowerCase();

  function run(sql: string, b: unknown[]) {
    if (sql.startsWith("INSERT INTO sns_contributors")) {
      const [chapterId, email, grantedBy, createdAt] = b as [number, string, string, string];
      if (!rows.some((row) => sameKey(row, chapterId, email))) {
        rows.push({
          chapter_id: chapterId,
          user_email: email,
          granted_by_user_id: grantedBy,
          created_at: createdAt,
        });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("DELETE FROM sns_contributors")) {
      const [chapterId, email] = b as [number, string];
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (sameKey(rows[i], chapterId, email)) {
          rows.splice(i, 1);
          removed++;
        }
      }
      return { meta: { changes: removed } };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  function all(sql: string, b: unknown[]) {
    if (sql.startsWith("SELECT user_email, created_at FROM sns_contributors")) {
      const [chapterId] = b as [number];
      const results = rows
        .filter((row) => row.chapter_id === chapterId)
        .sort((x, y) => x.user_email.toLowerCase().localeCompare(y.user_email.toLowerCase()))
        .map((row) => ({ user_email: row.user_email, created_at: row.created_at }));
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

function deps(db: D1Database): ContributorDependencies {
  return { db };
}

describe("addContributor", () => {
  it("inserts a new contributor row", async () => {
    const { db, rows } = makeDb();
    await addContributor(deps(db), 1, "new@example.com", "granter-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chapter_id: 1,
      user_email: "new@example.com",
      granted_by_user_id: "granter-1",
    });
  });

  it("treats a case-different email as the same contributor: no duplicate, no error", async () => {
    const { db, rows } = makeDb([
      {
        chapter_id: 1,
        user_email: "Foo@Example.com",
        granted_by_user_id: "granter-1",
        created_at: "t0",
      },
    ]);

    await expect(
      addContributor(deps(db), 1, "foo@example.com", "granter-2"),
    ).resolves.toBeUndefined();

    expect(rows).toHaveLength(1);
    // The existing row is left untouched — granted_by is not overwritten.
    expect(rows[0]).toMatchObject({
      user_email: "Foo@Example.com",
      granted_by_user_id: "granter-1",
    });
  });

  it("keeps rows for other chapters independent", async () => {
    const { db, rows } = makeDb([
      { chapter_id: 1, user_email: "x@example.com", granted_by_user_id: "g", created_at: "t0" },
    ]);
    await addContributor(deps(db), 2, "x@example.com", "g");
    expect(rows).toHaveLength(2);
  });
});

describe("removeContributor", () => {
  it("removes a contributor case-insensitively", async () => {
    const { db, rows } = makeDb([
      { chapter_id: 1, user_email: "Foo@Example.com", granted_by_user_id: "g", created_at: "t0" },
    ]);
    await removeContributor(deps(db), 1, "foo@example.com");
    expect(rows).toHaveLength(0);
  });

  it("is a no-op when the contributor does not exist", async () => {
    const { db, rows } = makeDb();
    await expect(removeContributor(deps(db), 1, "missing@example.com")).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
  });
});

describe("listChapterContributors", () => {
  it("returns this chapter's contributors ordered case-insensitively", async () => {
    const { db } = makeDb([
      { chapter_id: 1, user_email: "beta@example.com", granted_by_user_id: "g", created_at: "t1" },
      { chapter_id: 1, user_email: "Alpha@example.com", granted_by_user_id: "g", created_at: "t0" },
      { chapter_id: 2, user_email: "other@example.com", granted_by_user_id: "g", created_at: "t2" },
    ]);
    const contributors = await listChapterContributors(deps(db), 1);
    expect(contributors).toEqual([
      { email: "Alpha@example.com", createdAt: "t0" },
      { email: "beta@example.com", createdAt: "t1" },
    ]);
  });
});
