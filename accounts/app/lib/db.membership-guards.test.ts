import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { demoteMembershipUnlessLastOrganizer, removeMembershipUnlessLastOrganizer } from "./db";

const membershipRow = {
  user_id: "target-user",
  chapter_id: 1,
  role: "organizer",
  status: "active",
  created_at: 1,
  approved_at: 1,
  c_id: 1,
  c_slug: "gdg-test",
  c_name: "GDG Test",
  c_kind: "gdg",
  c_created_at: 1,
};

function fakeDb({ exists = true, changes = 1 }: { exists?: boolean; changes?: number } = {}) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          return exists ? membershipRow : null;
        },
        async run() {
          return { meta: { changes } };
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
  } as D1Database;
  return { db, statements };
}

describe("organizer membership guards", () => {
  it("blocks demoting the last active organizer", async () => {
    const { db, statements } = fakeDb({ changes: 0 });
    await expect(demoteMembershipUnlessLastOrganizer(db, "target-user", 1)).resolves.toBe(
      "last_active_organizer",
    );
    expect(statements.at(-1)).toContain("other.role = 'organizer'");
  });

  it("demotes when another active organizer exists", async () => {
    const { db } = fakeDb({ changes: 1 });
    await expect(demoteMembershipUnlessLastOrganizer(db, "target-user", 1)).resolves.toBe(
      "updated",
    );
  });

  it("blocks removing the last active organizer", async () => {
    const { db, statements } = fakeDb({ changes: 0 });
    await expect(removeMembershipUnlessLastOrganizer(db, "target-user", 1)).resolves.toBe(
      "last_active_organizer",
    );
    expect(statements.at(-1)).toContain("other.role = 'organizer'");
  });

  it("reports a missing membership without mutating", async () => {
    const { db, statements } = fakeDb({ exists: false });
    await expect(removeMembershipUnlessLastOrganizer(db, "missing", 1)).resolves.toBe("not_found");
    expect(statements).toHaveLength(1);
  });
});
