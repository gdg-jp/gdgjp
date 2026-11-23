import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("~/features/auth/auth.server", () => ({ requireUser: authMocks.requireUser }));
vi.mock("~/lib/i18n/i18n.server", () => ({
  i18n: {
    getFixedT: vi.fn(async () => (key: string) => key),
    getLocale: vi.fn(async () => "ja"),
  },
}));

import {
  actOnConnectedApps,
  listConnectedApps,
  loadConnectedApps,
  removeConnectedApp,
} from "~/features/oauth/connected-apps.server";
import { revokeUserSessions } from "~/features/users/user-admin.server";

const TRIGGER_MIGRATION = "0025_developer_client_grants_outlive_sessions.sql";
const NOW = new Date("2026-11-20T00:00:00.000Z");
const FUTURE = "2026-12-01T00:00:00.000Z";
const PAST = "2026-11-01T00:00:00.000Z";

type Statement = { sql: string; params: SQLInputValue[] };

function migratedDb(options: { stopBefore?: string } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  const files = readdirSync(directory).sort();
  const applyFrom = (index: number) => {
    for (const file of files.slice(index)) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  };
  const stop = options.stopBefore ? files.indexOf(options.stopBefore) : files.length;
  for (const file of files.slice(0, stop)) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  const run = ({ sql, params }: Statement) => raw.prepare(sql).all(...params);
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    sql,
    params,
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => run({ sql, params })[0] ?? null,
    all: async () => ({ results: run({ sql, params }) }),
    run: async () => ({ results: run({ sql, params }) }),
  });
  const batches: Statement[][] = [];
  const db = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Statement[]) {
      batches.push(statements);
      raw.exec("BEGIN");
      try {
        const results = statements.map((item) => ({ results: run(item) }));
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    raw,
    batches,
    db: db as unknown as D1Database,
    finishMigrations: () => applyFrom(stop),
  };
}

function seed(raw: DatabaseSync) {
  raw.exec(`INSERT INTO "user" (id, name, email) VALUES
    ('owner', '  Ada Owner  ', 'owner@example.com'),
    ('user-1', 'User One', 'one@example.com'),
    ('user-2', 'User Two', 'two@example.com')`);
  raw.exec(`INSERT INTO "oauthClient"
    (id, "clientId", name, uri, "redirectUris", "userId", disabled, "skipConsent", "grantTypes")
    VALUES
    ('c1', 'dev-app', 'Dev App', 'https://dev.example/', '[]', 'owner', 0, 1,
     '["authorization_code","refresh_token"]'),
    ('c2', 'dev-other', 'Other App', 'javascript:alert(1)', '[]', 'owner', 1, 1,
     '["authorization_code","refresh_token"]'),
    ('c3', 'fp-wiki', 'Wiki', 'https://wiki.example/', '[]', NULL, 0, 1,
     '["authorization_code","refresh_token"]'),
    ('c4', 'fp-cli', 'CLI', NULL, '[]', NULL, 0, 1,
     '["urn:ietf:params:oauth:grant-type:device_code","refresh_token"]')`);
}

function addSession(raw: DatabaseSync, id: string, userId: string) {
  raw
    .prepare(`INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, FUTURE, `token-${id}`, PAST, PAST, userId);
}

function addTokens(
  raw: DatabaseSync,
  input: {
    id: string;
    clientId: string;
    userId: string;
    sessionId?: string | null;
    scopes?: string[];
    createdAt?: string;
    expiresAt?: string;
    revoked?: string | null;
    accessOnly?: boolean;
  },
) {
  const scopes = JSON.stringify(input.scopes ?? ["openid", "offline_access"]);
  const createdAt = input.createdAt ?? PAST;
  const expiresAt = input.expiresAt ?? FUTURE;
  const sessionId = input.sessionId ?? null;
  const revoked = input.revoked ?? null;
  if (!input.accessOnly) {
    raw
      .prepare(`INSERT INTO "oauthRefreshToken"
        (id, token, "clientId", "sessionId", "userId", "expiresAt", "createdAt", revoked, scopes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        `r-${input.id}`,
        `rt-${input.id}`,
        input.clientId,
        sessionId,
        input.userId,
        expiresAt,
        createdAt,
        revoked,
        scopes,
      );
  }
  raw
    .prepare(`INSERT INTO "oauthAccessToken"
      (id, token, "clientId", "sessionId", "userId", "refreshId", "expiresAt", "createdAt",
       revoked, scopes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      `a-${input.id}`,
      `at-${input.id}`,
      input.clientId,
      sessionId,
      input.userId,
      input.accessOnly ? null : `r-${input.id}`,
      expiresAt,
      createdAt,
      revoked,
      scopes,
    );
}

function addConsent(
  raw: DatabaseSync,
  input: { id: string; clientId: string; userId: string; scopes: string; createdAt?: string },
) {
  raw
    .prepare(`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      input.id,
      input.clientId,
      input.userId,
      input.scopes,
      input.createdAt ?? PAST,
      input.createdAt ?? PAST,
    );
}

function tokenIds(raw: DatabaseSync) {
  const ids = (table: string) =>
    (raw.prepare(`SELECT id FROM "${table}" ORDER BY id`).all() as { id: string }[]).map(
      (row) => row.id,
    );
  return { access: ids("oauthAccessToken"), refresh: ids("oauthRefreshToken") };
}

function consentIds(raw: DatabaseSync) {
  return (raw.prepare(`SELECT id FROM "oauthConsent" ORDER BY id`).all() as { id: string }[]).map(
    (row) => row.id,
  );
}

describe("migration 0025", () => {
  it("makes existing developer-owned clients ask for consent and leaves first-party ones", () => {
    const { raw, finishMigrations } = migratedDb({ stopBefore: TRIGGER_MIGRATION });
    seed(raw);

    finishMigrations();

    expect(
      raw.prepare(`SELECT "clientId", "skipConsent" FROM "oauthClient" ORDER BY "clientId"`).all(),
    ).toEqual([
      { clientId: "dev-app", skipConsent: 0 },
      { clientId: "dev-other", skipConsent: 0 },
      { clientId: "fp-cli", skipConsent: 1 },
      { clientId: "fp-wiki", skipConsent: 1 },
      { clientId: "gdg-cli", skipConsent: 1 },
    ]);
  });

  it("keeps developer-client and device-grant tokens when their session ends", () => {
    const { raw } = migratedDb();
    seed(raw);
    addSession(raw, "s1", "user-1");
    addSession(raw, "s2", "user-1");
    addTokens(raw, { id: "dev", clientId: "dev-app", userId: "user-1", sessionId: "s1" });
    addTokens(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", sessionId: "s1" });
    addTokens(raw, { id: "wiki-other", clientId: "fp-wiki", userId: "user-1", sessionId: "s2" });
    addTokens(raw, { id: "cli", clientId: "fp-cli", userId: "user-1", sessionId: "s1" });

    raw.exec(`DELETE FROM "session" WHERE id = 's1'`);

    expect(tokenIds(raw)).toEqual({
      access: ["a-cli", "a-dev", "a-wiki-other"],
      refresh: ["r-cli", "r-dev", "r-wiki-other"],
    });
    expect(
      raw.prepare(`SELECT "sessionId" FROM "oauthRefreshToken" WHERE id = 'r-dev'`).get(),
    ).toEqual({ sessionId: null });
  });

  it("still deletes every token when an administrator revokes the user's sessions", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addSession(raw, "s1", "user-1");
    addTokens(raw, { id: "dev", clientId: "dev-app", userId: "user-1", sessionId: "s1" });
    addTokens(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", sessionId: "s1" });

    await expect(revokeUserSessions(db, { actorId: "admin", targetId: "user-1" })).resolves.toEqual(
      { status: "revoked" },
    );

    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
  });
});

describe("listConnectedApps", () => {
  it("lists developer apps the user consented to or holds live tokens for", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, {
      id: "consent-1",
      clientId: "dev-app",
      userId: "user-1",
      scopes: JSON.stringify(["openid", "email"]),
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    addTokens(raw, {
      id: "dev-1",
      clientId: "dev-app",
      userId: "user-1",
      scopes: ["openid", "profile"],
      createdAt: "2026-11-03T00:00:00.000Z",
    });
    addTokens(raw, {
      id: "dev-2",
      clientId: "dev-app",
      userId: "user-1",
      createdAt: "2026-11-04T00:00:00.000Z",
      expiresAt: PAST,
    });
    addTokens(raw, {
      id: "other",
      clientId: "dev-other",
      userId: "user-1",
      scopes: ["openid", "offline_access"],
      createdAt: "2026-11-05T00:00:00.000Z",
    });
    addTokens(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1" });
    addTokens(raw, { id: "cli", clientId: "fp-cli", userId: "user-1" });
    addConsent(raw, {
      id: "consent-2",
      clientId: "dev-app",
      userId: "user-2",
      scopes: "[]",
    });

    await expect(listConnectedApps(db, "user-1", NOW)).resolves.toEqual([
      {
        clientId: "dev-other",
        name: "Other App",
        appUrl: null,
        ownerName: "Ada Owner",
        scopes: ["openid", "offline_access"],
        grantedAt: null,
        lastTokenAt: "2026-11-05T00:00:00.000Z",
        disabled: true,
      },
      {
        clientId: "dev-app",
        name: "Dev App",
        appUrl: "https://dev.example/",
        ownerName: "Ada Owner",
        scopes: ["openid", "email"],
        grantedAt: "2026-11-02T00:00:00.000Z",
        lastTokenAt: "2026-11-04T00:00:00.000Z",
        disabled: false,
      },
    ]);
  });

  it("orders by the latest activity and falls back to the consent date", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, {
      id: "consent-1",
      clientId: "dev-app",
      userId: "user-1",
      scopes: JSON.stringify(["openid"]),
      createdAt: "2026-11-10T00:00:00.000Z",
    });
    addTokens(raw, {
      id: "other",
      clientId: "dev-other",
      userId: "user-1",
      createdAt: "2026-11-05T00:00:00.000Z",
    });

    const apps = await listConnectedApps(db, "user-1", NOW);

    expect(apps.map((app) => [app.clientId, app.lastTokenAt])).toEqual([
      ["dev-app", null],
      ["dev-other", "2026-11-05T00:00:00.000Z"],
    ]);
  });

  it("omits apps whose only tokens are expired or revoked", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addTokens(raw, { id: "expired", clientId: "dev-app", userId: "user-1", expiresAt: PAST });
    addTokens(raw, { id: "revoked", clientId: "dev-other", userId: "user-1", revoked: PAST });

    await expect(listConnectedApps(db, "user-1", NOW)).resolves.toEqual([]);
  });

  it("lists an app with only a live access token", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addTokens(raw, { id: "access", clientId: "dev-app", userId: "user-1", accessOnly: true });

    const [app] = await listConnectedApps(db, "user-1", NOW);

    expect(app?.clientId).toBe("dev-app");
    expect(app?.scopes).toEqual([]);
  });

  it("uses the current time by default", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addTokens(raw, {
      id: "far",
      clientId: "dev-app",
      userId: "user-1",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    addTokens(raw, {
      id: "old",
      clientId: "dev-other",
      userId: "user-1",
      expiresAt: NOW.toISOString(),
    });

    const apps = await listConnectedApps(db, "user-1");

    expect(apps.map((app) => app.clientId)).toEqual(["dev-app"]);
  });

  it("tolerates names, owners and scopes that are missing or malformed", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    raw.exec(
      `UPDATE "oauthClient" SET name = '   ', uri = 'not a url' WHERE "clientId" = 'dev-app'`,
    );
    raw.exec(`UPDATE "user" SET name = '  ' WHERE id = 'owner'`);
    addConsent(raw, { id: "bad-json", clientId: "dev-app", userId: "user-1", scopes: "{" });
    addConsent(raw, {
      id: "not-array",
      clientId: "dev-other",
      userId: "user-1",
      scopes: JSON.stringify({ scope: "openid" }),
    });
    raw.exec(`UPDATE "oauthConsent" SET "createdAt" = '2026-11-02T00:00:00.000Z'
      WHERE id = 'not-array'`);
    addTokens(raw, { id: "mixed", clientId: "dev-other", userId: "user-2", scopes: [] });
    raw.exec(`UPDATE "oauthRefreshToken" SET scopes = '["openid", 7]' WHERE id = 'r-mixed'`);
    addConsent(raw, {
      id: "mixed-consent",
      clientId: "dev-other",
      userId: "user-2",
      scopes: '["email", null]',
    });

    const [devApp] = await listConnectedApps(db, "user-1", NOW);
    expect(devApp).toMatchObject({
      clientId: "dev-other",
      appUrl: null,
      ownerName: null,
      scopes: [],
    });
    const forUser1 = await listConnectedApps(db, "user-1", NOW);
    expect(forUser1.find((app) => app.clientId === "dev-app")).toMatchObject({
      name: "dev-app",
      appUrl: null,
      scopes: [],
    });
    const [forUser2] = await listConnectedApps(db, "user-2", NOW);
    expect(forUser2?.scopes).toEqual(["email"]);
  });
});

describe("removeConnectedApp", () => {
  it("deletes the user's consent and tokens for the app in one batch", async () => {
    const { raw, db, batches } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "theirs", clientId: "dev-app", userId: "user-2", scopes: "[]" });
    addConsent(raw, { id: "other-app", clientId: "dev-other", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "mine", clientId: "dev-app", userId: "user-1" });
    addTokens(raw, { id: "mine-access", clientId: "dev-app", userId: "user-1", accessOnly: true });
    addTokens(raw, { id: "theirs", clientId: "dev-app", userId: "user-2" });
    addTokens(raw, { id: "other-app", clientId: "dev-other", userId: "user-1" });

    await removeConnectedApp(db, "user-1", "dev-app");

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(consentIds(raw)).toEqual(["other-app", "theirs"]);
    expect(tokenIds(raw)).toEqual({
      access: ["a-other-app", "a-theirs"],
      refresh: ["r-other-app", "r-theirs"],
    });
  });

  it("leaves first-party grants alone", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1" });
    addTokens(raw, { id: "cli", clientId: "fp-cli", userId: "user-1" });

    await removeConnectedApp(db, "user-1", "fp-wiki");
    await removeConnectedApp(db, "user-1", "fp-cli");

    expect(consentIds(raw)).toEqual(["wiki"]);
    expect(tokenIds(raw)).toEqual({ access: ["a-cli", "a-wiki"], refresh: ["r-cli", "r-wiki"] });
  });
});

describe("connected apps route handlers", () => {
  const USER = { id: "user-1", email: "one@example.com", name: "User One", isAdmin: false };

  beforeEach(() => {
    authMocks.requireUser.mockReset();
  });

  function args(db: D1Database, body?: Record<string, string>) {
    const request = body
      ? new Request("https://accounts.example/settings/connected-apps", {
          method: "POST",
          body: new URLSearchParams(body),
        })
      : new Request("https://accounts.example/settings/connected-apps");
    return { request, context: { cloudflare: { env: { DB: db } } } } as never;
  }

  it("loads the signed-in user's apps", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addTokens(raw, {
      id: "dev",
      clientId: "dev-app",
      userId: "user-1",
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    authMocks.requireUser.mockResolvedValue(USER);

    const data = await loadConnectedApps(args(db));

    expect(data.title).toBe("meta.connectedApps");
    expect(data.locale).toBe("ja");
    expect(data.apps.map((app) => app.clientId)).toEqual(["dev-app"]);
  });

  it("sends a signed-out visitor to sign in", async () => {
    const { db } = migratedDb();
    authMocks.requireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));

    const thrown = await loadConnectedApps(args(db)).catch((value: unknown) => value);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toContain("/signin");
  });

  it("rethrows other failures", async () => {
    const { db } = migratedDb();
    const unavailable = new Response("Unavailable", { status: 503 });
    authMocks.requireUser.mockRejectedValueOnce(unavailable);
    await expect(loadConnectedApps(args(db))).rejects.toBe(unavailable);

    const error = new Error("boom");
    authMocks.requireUser.mockRejectedValueOnce(error);
    await expect(actOnConnectedApps(args(db, { intent: "remove" }))).rejects.toBe(error);
  });

  it("removes access only for the signed-in user", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "theirs", clientId: "dev-app", userId: "user-2", scopes: "[]" });
    authMocks.requireUser.mockResolvedValue(USER);

    await expect(
      actOnConnectedApps(args(db, { intent: "remove", clientId: "dev-app", userId: "user-2" })),
    ).resolves.toEqual({ ok: true, clientId: "dev-app" });
    expect(consentIds(raw)).toEqual(["theirs"]);
  });

  it.each([
    [{ intent: "noop", clientId: "dev-app" }],
    [{ intent: "remove", clientId: "" }],
    [{ intent: "remove" }],
  ])("ignores an incomplete request %o", async (body) => {
    const { raw, db, batches } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    authMocks.requireUser.mockResolvedValue(USER);

    await expect(actOnConnectedApps(args(db, body))).resolves.toEqual({ ok: false });
    expect(batches).toEqual([]);
    expect(consentIds(raw)).toEqual(["mine"]);
  });
});
