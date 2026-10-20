import { beforeEach, describe, expect, it, vi } from "vitest";

const memberships = vi.hoisted(() => ({ listActiveChaptersForUser: vi.fn() }));
vi.mock("~/features/memberships/repository.server", () => ({
  listActiveChaptersForUser: memberships.listActiveChaptersForUser,
}));

import { sha256Base64Url } from "~/lib/crypto.server";
import { handleRpSessionCheck } from "./rp-session.server";

type Row = Record<string, unknown> | null;

function fakeDb(rows: { client?: Row; session?: Row }) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM "oauthClient"')) return rows.client ?? null;
              if (sql.includes('FROM "session"')) return rows.session ?? null;
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, statements };
}

function env(db: D1Database) {
  return { DB: db, OST_CLIENT_ID: "ost", WIKI_CLIENT_ID: "wiki" } as unknown as Env;
}

function check(body: unknown, credentials = "ost:secret") {
  return new Request("https://accounts.gdgs.jp/api/rp/v1/session", {
    method: "POST",
    headers: { authorization: `Basic ${btoa(credentials)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const future = new Date(Date.now() + 3_600_000).toISOString();

async function liveSession() {
  return {
    client: { clientSecret: await sha256Base64Url("secret"), disabled: 0 },
    session: {
      sessionId: "sid-1",
      userId: "user-1",
      expiresAt: future,
      email: "a@example.com",
      name: "A",
      image: null,
      emailVerified: 1,
      isAdmin: 1,
    },
  };
}

describe("handleRpSessionCheck", () => {
  beforeEach(() => {
    memberships.listActiveChaptersForUser.mockReset();
    memberships.listActiveChaptersForUser.mockResolvedValue([
      { chapterId: 1, chapterSlug: "tokyo", role: "organizer" },
    ]);
  });

  it("returns current claims for a live session bound to the subject", async () => {
    const { db } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      active: true,
      sub: "user-1",
      email: "a@example.com",
      email_verified: true,
      "https://gdgs.jp/claims/is_admin": true,
      "https://gdgs.jp/claims/chapters": [
        { chapterId: 1, chapterSlug: "tokyo", role: "organizer" },
      ],
    });
  });

  it("reports an inactive session when the subject does not own it", async () => {
    const { db } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-2" }));
    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("reports an inactive session when it no longer exists", async () => {
    const rows = await liveSession();
    const { db } = fakeDb({ client: rows.client, session: null });
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("ends an expired session so its OAuth grants are revoked", async () => {
    const rows = await liveSession();
    const { db, statements } = fakeDb({
      client: rows.client,
      session: { ...rows.session, expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
    await expect(response.json()).resolves.toEqual({ active: false });
    expect(statements).toContain('DELETE FROM "session" WHERE "id" = ?');
  });

  it("refuses a wrong client secret", async () => {
    const { db } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(
      env(db),
      check({ sid: "sid-1", sub: "user-1" }, "ost:wrong"),
    );
    expect(response.status).toBe(401);
  });

  it("refuses clients that are not first-party relying parties", async () => {
    const { db } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(
      env(db),
      check({ sid: "sid-1", sub: "user-1" }, "third-party:secret"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const { db } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(env(db), check({ sid: 1 }));
    expect(response.status).toBe(400);
  });
});
