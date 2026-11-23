import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memberships = vi.hoisted(() => ({ listActiveChaptersForUser: vi.fn() }));
vi.mock("~/features/memberships/repository.server", () => ({
  listActiveChaptersForUser: memberships.listActiveChaptersForUser,
}));

import { sha256Base64Url } from "~/lib/crypto.server";
import { firstPartyRpClientIds, handleRpSessionCheck } from "./rp-session.server";
import { collectSpecs } from "./seed-clients.server";

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns current claims for a live session bound to the subject", async () => {
    const { db } = fakeDb(await liveSession());
    memberships.listActiveChaptersForUser.mockResolvedValue([
      { chapterId: 1, chapterSlug: "tokyo", role: "organizer", chapterName: "Tokyo" },
    ]);
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      active: true,
      sub: "user-1",
      email: "a@example.com",
      email_verified: true,
      name: "A",
      picture: null,
      "https://gdgs.jp/claims/is_admin": true,
      "https://gdgs.jp/claims/chapters": [
        { chapterId: 1, chapterSlug: "tokyo", role: "organizer" },
      ],
      session_expires_at: Date.parse(future),
    });
    expect(memberships.listActiveChaptersForUser).toHaveBeenCalledWith(db, "user-1");
  });

  it("reports unverified email and non-admin users as such", async () => {
    const rows = await liveSession();
    const { db } = fakeDb({
      client: rows.client,
      session: { ...rows.session, emailVerified: 0, isAdmin: 0 },
    });
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
    await expect(response.json()).resolves.toMatchObject({
      email_verified: false,
      "https://gdgs.jp/claims/is_admin": false,
    });
  });

  it("treats a session expiring right now as ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(future));
    const { db, statements } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
    await expect(response.json()).resolves.toEqual({ active: false });
    expect(statements).toContain('DELETE FROM "session" WHERE "id" = ?');
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
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "invalid_client" });
  });

  it("refuses credentials that are not well-formed HTTP Basic", async () => {
    const rows = await liveSession();
    const body = JSON.stringify({ sid: "sid-1", sub: "user-1" });
    for (const [authorization, secret] of [
      [`Bearer ${btoa("ost:secret")}`, "secret"],
      ["Basic !!!", "secret"],
      [`Basic ${btoa("ost!")}`, "ost!"],
    ]) {
      const { db } = fakeDb({
        client: { clientSecret: await sha256Base64Url(secret), disabled: 0 },
        session: rows.session,
      });
      const response = await handleRpSessionCheck(
        env(db),
        new Request("https://accounts.gdgs.jp/api/rp/v1/session", {
          method: "POST",
          headers: { authorization },
          body,
        }),
      );
      expect(response.status, authorization).toBe(401);
    }
  });

  it("refuses a client without a stored secret, a disabled one, or an unknown one", async () => {
    const rows = await liveSession();
    for (const client of [
      null,
      { clientSecret: null, disabled: 0 },
      { ...rows.client, disabled: 1 },
      { ...rows.client, clientSecret: `${rows.client.clientSecret}x` },
    ]) {
      const { db } = fakeDb({ client, session: rows.session });
      const response = await handleRpSessionCheck(env(db), check({ sid: "sid-1", sub: "user-1" }));
      expect(response.status, JSON.stringify(client)).toBe(401);
    }
  });

  it("form-decodes both credential parts before comparing them (RFC 6749 section 2.3.1)", async () => {
    const rows = await liveSession();
    const { db } = fakeDb({
      client: { clientSecret: await sha256Base64Url("s cret"), disabled: 0 },
      session: rows.session,
    });
    const response = await handleRpSessionCheck(
      { DB: db, OST_CLIENT_ID: "o st" } as unknown as Env,
      check({ sid: "sid-1", sub: "user-1" }, "o+st:s+cret"),
    );
    expect(response.status).toBe(200);
  });

  it("refuses clients that are not first-party relying parties", async () => {
    const { db } = fakeDb(await liveSession());
    const response = await handleRpSessionCheck(
      env(db),
      check({ sid: "sid-1", sub: "user-1" }, "third-party:secret"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a body without a non-empty string sid and sub", async () => {
    const { db } = fakeDb(await liveSession());
    for (const body of [
      { sid: 1, sub: "user-1" },
      { sid: "", sub: "user-1" },
      { sid: "sid-1", sub: 1 },
      { sid: "sid-1", sub: "" },
    ]) {
      const response = await handleRpSessionCheck(env(db), check(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    }
    const notJson = new Request("https://accounts.gdgs.jp/api/rp/v1/session", {
      method: "POST",
      headers: { authorization: `Basic ${btoa("ost:secret")}` },
      body: "{",
    });
    const response = await handleRpSessionCheck(env(db), notJson);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
  });

  it("lists only the first-party client IDs that are configured", () => {
    expect(
      firstPartyRpClientIds({ OST_CLIENT_ID: "ost", WIKI_CLIENT_ID: "wiki" } as unknown as Env),
    ).toEqual(["wiki", "ost"]);
  });

  it("accepts every seeded gdg-lib relying party (all but the agents and MCP clients)", () => {
    const all = new Proxy({} as Env, {
      get: (_, key) => (typeof key === "string" ? key.toLowerCase() : undefined),
    });
    const seeded = collectSpecs(all)
      .map((spec) => spec.clientId)
      .filter((id) => id !== "agents_client_id" && id !== "mcp_client_id");
    expect(firstPartyRpClientIds(all).sort()).toEqual(seeded.sort());
  });
});
