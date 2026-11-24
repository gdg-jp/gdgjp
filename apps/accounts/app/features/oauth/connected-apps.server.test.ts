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
    ('c2', 'dev-other', 'Other App', 'javascript:alert(1)', '[]', 'owner', 0, 1,
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
  whileConsented(raw, input.clientId, input.userId, () => {
    if (!input.accessOnly) {
      insertRefreshToken(raw, {
        id: `r-${input.id}`,
        clientId: input.clientId,
        userId: input.userId,
        sessionId,
        expiresAt,
        createdAt,
        revoked,
        scopes,
      });
    }
    insertAccessToken(raw, {
      id: `a-${input.id}`,
      clientId: input.clientId,
      userId: input.userId,
      refreshId: input.accessOnly ? null : `r-${input.id}`,
      sessionId,
      expiresAt,
      createdAt,
      revoked,
      scopes,
    });
  });
}

function whileConsented(raw: DatabaseSync, clientId: string, userId: string, issue: () => void) {
  const consented = raw
    .prepare(`SELECT 1 FROM "oauthConsent" WHERE "clientId" = ? AND "userId" = ?`)
    .get(clientId, userId);
  if (consented) return issue();
  addConsent(raw, { id: "issuing", clientId, userId, scopes: "[]" });
  issue();
  detachConsent(raw, "issuing");
}

function detachConsent(raw: DatabaseSync, id: string) {
  raw.prepare(`UPDATE "oauthConsent" SET "userId" = NULL WHERE id = ?`).run(id);
  raw.prepare(`DELETE FROM "oauthConsent" WHERE id = ?`).run(id);
}

type TokenRow = {
  id: string;
  clientId: string;
  userId: string | null;
  sessionId?: string | null;
  refreshId?: string | null;
  expiresAt?: string;
  createdAt?: string;
  revoked?: string | null;
  scopes?: string;
  resources?: string | null;
  code?: string | null;
};

let issuedCodes = 0;

function issueGrantCode(raw: DatabaseSync, clientId: string, userId: string | null) {
  issuedCodes += 1;
  const identifier = `grant-${issuedCodes}`;
  raw
    .prepare(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      identifier,
      identifier,
      JSON.stringify({
        type: "authorization_code",
        query: { client_id: clientId, scope: "openid offline_access" },
        userId,
      }),
      FUTURE,
      PAST,
      PAST,
    );
  raw.prepare(`DELETE FROM "verification" WHERE id = ?`).run(identifier);
  return identifier;
}

function grantCodeIds(raw: DatabaseSync) {
  return (
    raw
      .prepare(`SELECT "authorizationCodeId" AS id FROM "developerClientGrantCode" ORDER BY 1`)
      .all() as { id: string }[]
  ).map((row) => row.id);
}

function insertRefreshToken(raw: DatabaseSync, row: TokenRow) {
  raw
    .prepare(`INSERT INTO "oauthRefreshToken"
      (id, token, "clientId", "sessionId", "userId", "expiresAt", "createdAt", revoked, scopes,
       resources, "authorizationCodeId")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      `token-${row.id}`,
      row.clientId,
      row.sessionId ?? null,
      row.userId,
      row.expiresAt ?? FUTURE,
      row.createdAt ?? PAST,
      row.revoked ?? null,
      row.scopes ?? '["openid"]',
      row.resources ?? null,
      row.code === undefined ? issueGrantCode(raw, row.clientId, row.userId) : row.code,
    );
}

function insertAccessToken(raw: DatabaseSync, row: TokenRow) {
  raw
    .prepare(`INSERT INTO "oauthAccessToken"
      (id, token, "clientId", "sessionId", "userId", "refreshId", "expiresAt", "createdAt",
       revoked, scopes, resources, "authorizationCodeId")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      row.id,
      `token-${row.id}`,
      row.clientId,
      row.sessionId ?? null,
      row.userId,
      row.refreshId ?? null,
      row.expiresAt ?? FUTURE,
      row.createdAt ?? PAST,
      row.revoked ?? null,
      row.scopes ?? '["openid"]',
      row.resources ?? null,
      row.code === undefined ? issueGrantCode(raw, row.clientId, row.userId) : row.code,
    );
}

function addAuthorizationCode(
  raw: DatabaseSync,
  input: { id: string; clientId: string; userId: string; type?: string },
) {
  raw
    .prepare(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      input.id,
      `code-${input.id}`,
      JSON.stringify({
        type: input.type ?? "authorization_code",
        query: { client_id: input.clientId, scope: "openid offline_access" },
        userId: input.userId,
        sessionId: "s1",
      }),
      FUTURE,
      PAST,
      PAST,
    );
}

function verificationIds(raw: DatabaseSync) {
  return (raw.prepare(`SELECT id FROM "verification" ORDER BY id`).all() as { id: string }[]).map(
    (row) => row.id,
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

  it("refuses a developer-client token without the user's consent and accepts one with it", () => {
    const { raw } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "other-user", clientId: "dev-app", userId: "user-2", scopes: "[]" });
    addConsent(raw, { id: "other-app", clientId: "dev-other", userId: "user-1", scopes: "[]" });
    const refresh = { id: "r-1", clientId: "dev-app", userId: "user-1" };
    const access = { id: "a-1", clientId: "dev-app", userId: "user-1", refreshId: "r-1" };

    expect(() => insertRefreshToken(raw, refresh)).toThrow(
      /developer client token without consent/,
    );
    expect(() => insertAccessToken(raw, { ...access, refreshId: null })).toThrow(
      /developer client token without consent/,
    );
    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });

    addConsent(raw, { id: "granted", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    insertRefreshToken(raw, refresh);
    insertAccessToken(raw, access);

    expect(tokenIds(raw)).toEqual({ access: ["a-1"], refresh: ["r-1"] });
  });

  it("refuses a developer-client refresh token that names a resource, even with consent", () => {
    const { raw } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "granted", clientId: "dev-app", userId: "user-1", scopes: "[]" });

    expect(() =>
      insertRefreshToken(raw, {
        id: "r-1",
        clientId: "dev-app",
        userId: "user-1",
        resources: '["https://accounts.example/api/auth/oauth2/userinfo"]',
      }),
    ).toThrow(/developer client token without consent/);
    insertAccessToken(raw, {
      id: "a-1",
      clientId: "dev-app",
      userId: "user-1",
      resources: '["https://accounts.example/api/auth/oauth2/userinfo"]',
    });

    expect(tokenIds(raw)).toEqual({ access: ["a-1"], refresh: [] });
  });

  it("leaves first-party, device-grant and userless token inserts alone", () => {
    const { raw } = migratedDb();
    seed(raw);
    const resources = '["https://accounts.example/api/auth/oauth2/userinfo"]';

    for (const clientId of ["fp-wiki", "fp-cli", "gdg-cli"]) {
      insertRefreshToken(raw, { id: `r-${clientId}`, clientId, userId: "user-1", resources });
      insertAccessToken(raw, { id: `a-${clientId}`, clientId, userId: "user-1", resources });
      insertAccessToken(raw, { id: `m-${clientId}`, clientId, userId: null });
    }
    insertAccessToken(raw, { id: "m-dev-app", clientId: "dev-app", userId: null });

    expect(tokenIds(raw)).toEqual({
      access: [
        "a-fp-cli",
        "a-fp-wiki",
        "a-gdg-cli",
        "m-dev-app",
        "m-fp-cli",
        "m-fp-wiki",
        "m-gdg-cli",
      ],
      refresh: ["r-fp-cli", "r-fp-wiki", "r-gdg-cli"],
    });
  });

  it("deletes every existing developer-client token and pending code on upgrade", () => {
    const { raw, finishMigrations } = migratedDb({ stopBefore: TRIGGER_MIGRATION });
    seed(raw);
    const resources = '["https://accounts.example/api/auth/oauth2/userinfo"]';
    addConsent(raw, { id: "narrow", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, {
      id: "wide",
      clientId: "dev-other",
      userId: "user-1",
      scopes: '["openid","offline_access"]',
    });
    insertRefreshToken(raw, { id: "r-narrow", clientId: "dev-app", userId: "user-1" });
    insertAccessToken(raw, {
      id: "a-narrow",
      clientId: "dev-app",
      userId: "user-1",
      refreshId: "r-narrow",
      scopes: '["openid","email"]',
    });
    insertRefreshToken(raw, { id: "r-covered", clientId: "dev-other", userId: "user-1" });
    insertAccessToken(raw, { id: "a-covered", clientId: "dev-other", userId: "user-1" });
    insertRefreshToken(raw, { id: "r-resource", clientId: "dev-app", userId: "user-2", resources });
    insertAccessToken(raw, { id: "a-unconsented", clientId: "dev-app", userId: "user-2" });
    insertAccessToken(raw, { id: "a-userless", clientId: "dev-app", userId: null });
    insertRefreshToken(raw, { id: "r-wiki", clientId: "fp-wiki", userId: "user-1", resources });
    insertAccessToken(raw, { id: "a-wiki", clientId: "fp-wiki", userId: "user-2" });
    insertRefreshToken(raw, { id: "r-cli", clientId: "gdg-cli", userId: "user-2" });
    addAuthorizationCode(raw, { id: "code-consented", clientId: "dev-app", userId: "user-1" });
    addAuthorizationCode(raw, { id: "code-unconsented", clientId: "dev-other", userId: "user-2" });
    addAuthorizationCode(raw, { id: "code-wiki", clientId: "fp-wiki", userId: "user-1" });
    addAuthorizationCode(raw, {
      id: "state-dev",
      clientId: "dev-app",
      userId: "user-1",
      type: "oauth_state",
    });
    raw.exec(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES ('plain', 'plain', 'not json', '${FUTURE}', '${PAST}', '${PAST}')`);

    finishMigrations();

    expect(tokenIds(raw)).toEqual({ access: ["a-wiki"], refresh: ["r-cli", "r-wiki"] });
    expect(consentIds(raw)).toEqual(["narrow", "wide"]);
    expect(verificationIds(raw)).toEqual(["code-wiki", "plain", "state-dev"]);
  });

  it("revokes the user's grant for an app when its last consent row is deleted", () => {
    const { raw } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "first", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "second", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "theirs", clientId: "dev-app", userId: "user-2", scopes: "[]" });
    addConsent(raw, { id: "other-app", clientId: "dev-other", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", scopes: "[]" });
    for (const [id, clientId, userId] of [
      ["mine", "dev-app", "user-1"],
      ["theirs", "dev-app", "user-2"],
      ["other-app", "dev-other", "user-1"],
      ["wiki", "fp-wiki", "user-1"],
    ] as const) {
      addTokens(raw, { id, clientId, userId });
      addAuthorizationCode(raw, { id: `code-${id}`, clientId, userId });
    }
    addAuthorizationCode(raw, {
      id: "state-mine",
      clientId: "dev-app",
      userId: "user-1",
      type: "oauth_state",
    });
    const unchanged = {
      tokens: tokenIds(raw),
      codes: ["code-mine", "code-other-app", "code-theirs", "code-wiki", "state-mine"],
    };
    expect(verificationIds(raw)).toEqual(unchanged.codes);

    raw.exec(`DELETE FROM "oauthConsent" WHERE id = 'first'`);
    expect(tokenIds(raw)).toEqual(unchanged.tokens);
    expect(verificationIds(raw)).toEqual(unchanged.codes);

    raw.exec(`DELETE FROM "oauthConsent" WHERE id IN ('second', 'wiki')`);
    expect(tokenIds(raw)).toEqual({
      access: ["a-other-app", "a-theirs", "a-wiki"],
      refresh: ["r-other-app", "r-theirs", "r-wiki"],
    });
    expect(verificationIds(raw)).toEqual([
      "code-other-app",
      "code-theirs",
      "code-wiki",
      "state-mine",
    ]);
  });

  it("deletes both duplicate consent rows' grant in one statement", () => {
    const { raw } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "first", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "second", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "mine", clientId: "dev-app", userId: "user-1" });

    raw.exec(`DELETE FROM "oauthConsent" WHERE "clientId" = 'dev-app'`);

    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
  });

  it("lets a user or client deletion cascade through consent", () => {
    const { raw } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "theirs", clientId: "dev-other", userId: "user-2", scopes: "[]" });
    addTokens(raw, { id: "mine", clientId: "dev-app", userId: "user-1" });
    addTokens(raw, { id: "theirs", clientId: "dev-other", userId: "user-2" });
    addAuthorizationCode(raw, { id: "code-theirs", clientId: "dev-other", userId: "user-2" });

    raw.exec(`DELETE FROM "user" WHERE id = 'user-1'`);
    raw.exec(`DELETE FROM "oauthClient" WHERE "clientId" = 'dev-other'`);

    expect(consentIds(raw)).toEqual([]);
    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
    expect(verificationIds(raw)).toEqual(["code-theirs"]);
  });

  it("keeps consent when the owner's last membership ends and migration 0014 revokes tokens", () => {
    const { raw } = migratedDb();
    seed(raw);
    raw.exec(`INSERT INTO chapters (id, slug, name, kind) VALUES (1, 'tokyo', 'Tokyo', 'gdg')`);
    raw.exec(`INSERT INTO memberships (user_id, chapter_id, role, status)
      VALUES ('owner', 1, 'member', 'active')`);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "mine", clientId: "dev-app", userId: "user-1" });

    raw.exec(`DELETE FROM memberships WHERE user_id = 'owner'`);

    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
    expect(consentIds(raw)).toEqual(["mine"]);
    expect(
      raw.prepare(`SELECT disabled FROM "oauthClient" WHERE "clientId" = 'dev-app'`).get(),
    ).toEqual({ disabled: 1 });
  });

  it("revokes developer grants and every token when an administrator revokes the user's sessions", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addSession(raw, "s1", "user-1");
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addConsent(raw, { id: "theirs", clientId: "dev-app", userId: "user-2", scopes: "[]" });
    addConsent(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "dev", clientId: "dev-app", userId: "user-1", sessionId: "s1" });
    addTokens(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", sessionId: "s1" });
    addAuthorizationCode(raw, { id: "code-mine", clientId: "dev-app", userId: "user-1" });

    await expect(revokeUserSessions(db, { actorId: "admin", targetId: "user-1" })).resolves.toEqual(
      { status: "revoked" },
    );

    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
    expect(consentIds(raw)).toEqual(["theirs", "wiki"]);
    expect(verificationIds(raw)).toEqual([]);
  });

  it("stops a rotation whose successor lands on either side of an administrator's revocation", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    insertRefreshToken(raw, { id: "r-before", clientId: "dev-app", userId: "user-1" });

    await revokeUserSessions(db, { actorId: "admin", targetId: "user-1" });

    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
    expect(() =>
      insertRefreshToken(raw, { id: "r-after", clientId: "dev-app", userId: "user-1" }),
    ).toThrow(/developer client token without consent/);
  });
});

describe("grants bound to the consent they were issued under", () => {
  it("refuses an old grant's token after removal and re-approval, and accepts a new grant", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, {
      id: "wide",
      clientId: "dev-app",
      userId: "user-1",
      scopes: '["openid","offline_access","email"]',
    });
    const oldCode = issueGrantCode(raw, "dev-app", "user-1");
    insertRefreshToken(raw, { id: "r-old", clientId: "dev-app", userId: "user-1", code: oldCode });

    await removeConnectedApp(db, "user-1", "dev-app");
    addConsent(raw, { id: "narrow", clientId: "dev-app", userId: "user-1", scopes: '["openid"]' });

    expect(grantCodeIds(raw)).toEqual([]);
    expect(() =>
      insertRefreshToken(raw, {
        id: "r-rotated",
        clientId: "dev-app",
        userId: "user-1",
        code: oldCode,
        scopes: '["openid","offline_access","email"]',
      }),
    ).toThrow(/developer client token without consent/);
    expect(() =>
      insertAccessToken(raw, {
        id: "a-exchanged",
        clientId: "dev-app",
        userId: "user-1",
        code: oldCode,
      }),
    ).toThrow(/developer client token without consent/);

    const newCode = issueGrantCode(raw, "dev-app", "user-1");
    insertRefreshToken(raw, { id: "r-new", clientId: "dev-app", userId: "user-1", code: newCode });
    insertAccessToken(raw, {
      id: "a-new",
      clientId: "dev-app",
      userId: "user-1",
      refreshId: "r-new",
      code: newCode,
    });

    expect(tokenIds(raw)).toEqual({ access: ["a-new"], refresh: ["r-new"] });
  });

  it("refuses a developer-client token whose code was issued without consent or names no code", () => {
    const { raw } = migratedDb();
    seed(raw);
    const unconsented = issueGrantCode(raw, "dev-app", "user-1");
    addConsent(raw, { id: "granted", clientId: "dev-app", userId: "user-1", scopes: "[]" });

    for (const code of [unconsented, null, "never-issued"]) {
      expect(() =>
        insertRefreshToken(raw, { id: "r-1", clientId: "dev-app", userId: "user-1", code }),
      ).toThrow(/developer client token without consent/);
      expect(() =>
        insertAccessToken(raw, { id: "a-1", clientId: "dev-app", userId: "user-1", code }),
      ).toThrow(/developer client token without consent/);
    }
    expect(grantCodeIds(raw)).toEqual([]);
  });

  it("records no grant for a code that stores a resource or belongs to another user", () => {
    const { raw } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "granted", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    const insert = (id: string, value: Record<string, unknown>) =>
      raw
        .prepare(`INSERT INTO "verification"
          (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, id, JSON.stringify(value), FUTURE, PAST, PAST);
    const query = { client_id: "dev-app", scope: "openid" };

    insert("stored", {
      type: "authorization_code",
      query,
      userId: "user-1",
      resource: ["https://r"],
    });
    insert("queried", {
      type: "authorization_code",
      query: { ...query, resource: "https://r" },
      userId: "user-1",
    });
    insert("other-user", { type: "authorization_code", query, userId: "user-2" });
    insert("state", { type: "oauth_state", query, userId: "user-1" });
    insert("empty-resource", { type: "authorization_code", query, userId: "user-1", resource: [] });
    insert("wiki", {
      type: "authorization_code",
      query: { client_id: "fp-wiki", scope: "openid" },
      userId: "user-1",
    });

    expect(grantCodeIds(raw)).toEqual(["empty-resource"]);
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
        disabled: false,
      },
      {
        clientId: "dev-app",
        name: "Dev App",
        appUrl: "https://dev.example/",
        ownerName: "Ada Owner",
        scopes: ["openid", "email", "profile"],
        grantedAt: "2026-11-02T00:00:00.000Z",
        lastTokenAt: "2026-11-04T00:00:00.000Z",
        disabled: false,
      },
    ]);
  });

  it("keeps listing a consented app whose owner disabled it, without its tokens", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, {
      id: "consent-1",
      clientId: "dev-other",
      userId: "user-1",
      scopes: JSON.stringify(["openid"]),
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    addTokens(raw, { id: "other", clientId: "dev-other", userId: "user-1" });

    raw.exec(`UPDATE "oauthClient" SET disabled = 1 WHERE "clientId" = 'dev-other'`);

    await expect(listConnectedApps(db, "user-1", NOW)).resolves.toMatchObject([
      {
        clientId: "dev-other",
        scopes: ["openid"],
        grantedAt: "2026-11-02T00:00:00.000Z",
        lastTokenAt: null,
        disabled: true,
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
    expect(app?.scopes).toEqual(["openid", "offline_access"]);
  });

  it("shows every scope the app holds across consents and live tokens", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addTokens(raw, {
      id: "wide",
      clientId: "dev-app",
      userId: "user-1",
      scopes: ["openid", "email", "offline_access"],
      createdAt: "2026-11-03T00:00:00.000Z",
    });
    addTokens(raw, {
      id: "profile",
      clientId: "dev-app",
      userId: "user-1",
      scopes: ["profile"],
      createdAt: "2026-11-04T00:00:00.000Z",
      accessOnly: true,
    });
    addTokens(raw, {
      id: "expired",
      clientId: "dev-app",
      userId: "user-1",
      scopes: ["https://gdgs.jp/scopes/chapters"],
      expiresAt: PAST,
    });
    addTokens(raw, {
      id: "revoked",
      clientId: "dev-app",
      userId: "user-1",
      scopes: ["https://gdgs.jp/scopes/cli"],
      revoked: PAST,
    });
    addTokens(raw, { id: "theirs", clientId: "dev-app", userId: "user-2", scopes: ["phone"] });
    addTokens(raw, { id: "other-app", clientId: "dev-other", userId: "user-1", scopes: ["x"] });
    addConsent(raw, {
      id: "narrow",
      clientId: "dev-app",
      userId: "user-1",
      scopes: JSON.stringify(["openid"]),
      createdAt: "2026-11-05T00:00:00.000Z",
    });
    addConsent(raw, {
      id: "referenced",
      clientId: "dev-app",
      userId: "user-1",
      scopes: JSON.stringify(["address"]),
      createdAt: "2026-11-01T00:00:00.000Z",
    });

    const apps = await listConnectedApps(db, "user-1", NOW);

    expect(apps.find((app) => app.clientId === "dev-app")?.scopes).toEqual([
      "openid",
      "address",
      "profile",
      "email",
      "offline_access",
    ]);
  });

  it("drops an app whose last consent row is deleted", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "c", clientId: "dev-app", userId: "user-1", scopes: '["email"]' });
    addTokens(raw, { id: "live", clientId: "dev-app", userId: "user-1", scopes: ["openid"] });
    expect((await listConnectedApps(db, "user-1", NOW)).map((app) => app.clientId)).toEqual([
      "dev-app",
    ]);

    raw.exec(`DELETE FROM "oauthConsent" WHERE id = 'c'`);

    await expect(listConnectedApps(db, "user-1", NOW)).resolves.toEqual([]);
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
    expect(forUser2?.scopes).toEqual(["email", "openid"]);
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
    addAuthorizationCode(raw, { id: "mine", clientId: "dev-app", userId: "user-1" });
    addAuthorizationCode(raw, { id: "theirs", clientId: "dev-app", userId: "user-2" });
    addAuthorizationCode(raw, { id: "other-app", clientId: "dev-other", userId: "user-1" });
    addAuthorizationCode(raw, {
      id: "state",
      clientId: "dev-app",
      userId: "user-1",
      type: "oauth_state",
    });
    raw.exec(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES ('plain', 'plain', 'not json', '${FUTURE}', '${PAST}', '${PAST}')`);

    await removeConnectedApp(db, "user-1", "dev-app");

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
    expect(consentIds(raw)).toEqual(["other-app", "theirs"]);
    expect(tokenIds(raw)).toEqual({
      access: ["a-other-app", "a-theirs"],
      refresh: ["r-other-app", "r-theirs"],
    });
    expect(verificationIds(raw)).toEqual(["other-app", "plain", "state", "theirs"]);
  });

  it("stops a code exchange or refresh rotation that straddles the removal", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "mine", clientId: "dev-app", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "old", clientId: "dev-app", userId: "user-1" });
    raw.exec(`UPDATE "oauthRefreshToken" SET revoked = '${PAST}' WHERE id = 'r-old'`);
    insertRefreshToken(raw, { id: "r-before", clientId: "dev-app", userId: "user-1" });
    insertAccessToken(raw, { id: "a-before", clientId: "dev-app", userId: "user-1" });

    await removeConnectedApp(db, "user-1", "dev-app");

    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
    expect(() =>
      insertRefreshToken(raw, { id: "r-after", clientId: "dev-app", userId: "user-1" }),
    ).toThrow(/developer client token without consent/);
    expect(() =>
      insertAccessToken(raw, { id: "a-after", clientId: "dev-app", userId: "user-1" }),
    ).toThrow(/developer client token without consent/);
    expect(tokenIds(raw)).toEqual({ access: [], refresh: [] });
  });

  it("leaves first-party grants alone", async () => {
    const { raw, db } = migratedDb();
    seed(raw);
    addConsent(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1", scopes: "[]" });
    addTokens(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1" });
    addTokens(raw, { id: "cli", clientId: "fp-cli", userId: "user-1" });
    addAuthorizationCode(raw, { id: "wiki", clientId: "fp-wiki", userId: "user-1" });

    await removeConnectedApp(db, "user-1", "fp-wiki");
    await removeConnectedApp(db, "user-1", "fp-cli");

    expect(consentIds(raw)).toEqual(["wiki"]);
    expect(tokenIds(raw)).toEqual({ access: ["a-cli", "a-wiki"], refresh: ["r-cli", "r-wiki"] });
    expect(verificationIds(raw)).toEqual(["wiki"]);
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
