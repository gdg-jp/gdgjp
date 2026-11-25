import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock("~/features/auth/auth.server", () => ({
  CHAPTERS_SCOPE: "https://gdgs.jp/scopes/chapters",
  CLI_SCOPE: "https://gdgs.jp/scopes/cli",
  requireUser: authMocks.requireUser,
  trustedOAuthClientIds: () => [],
}));

import {
  createDeveloperClient,
  setDeveloperClientEnabled,
  updateDeveloperClient,
} from "~/features/developer-apps/oauth-clients.server";

const REVOCATION_MIGRATION = "0026_developer_client_revocation_holds_for_late_writes.sql";
const FUTURE = "2026-12-01T00:00:00.000Z";
const PAST = "2026-11-01T00:00:00.000Z";
const REVOKED = /developer client token without consent/;
const request = () => new Request("https://accounts.example");

type Hook = () => void;

function migratedDb(options: { stopBefore?: string } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  const files = readdirSync(directory).sort();
  const stop = options.stopBefore ? files.indexOf(options.stopBefore) : files.length;
  const apply = (from: number, to: number) => {
    for (const file of files.slice(from, to)) {
      raw.exec(readFileSync(new URL(file, directory), "utf8"));
    }
  };
  apply(0, stop);
  let afterRead: { table: string; hook: Hook } | null = null;
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => {
      const row = raw.prepare(sql).all(...params)[0] ?? null;
      if (afterRead && sql.includes(`FROM ${afterRead.table}`)) {
        const { hook } = afterRead;
        afterRead = null;
        hook();
      }
      return row;
    },
    all: async () => ({ results: raw.prepare(sql).all(...params) }),
    run: async () => {
      const result = raw.prepare(sql).run(...params);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  const env = { DB: { prepare: (sql: string) => statement(sql) } } as unknown as Env;
  return {
    raw,
    env,
    finishMigrations: () => apply(stop, files.length),
    onMembershipRead: (hook: Hook) => {
      afterRead = { table: "memberships", hook };
    },
    onClientRead: (hook: Hook) => {
      afterRead = { table: "oauthClient", hook };
    },
  };
}

function seed(raw: DatabaseSync) {
  raw.exec(`INSERT INTO chapters (id, slug, name, kind) VALUES (1, 'tokyo', 'Tokyo', 'gdg')`);
  raw.exec(`INSERT INTO "user" (id, name, email) VALUES
    ('owner', 'Owner', 'owner@example.com'),
    ('user-1', 'User One', 'one@example.com')`);
  join(raw);
  raw.exec(`INSERT INTO "oauthClient"
    (id, "clientId", name, "redirectUris", scopes, "userId", disabled, "skipConsent", "grantTypes")
    VALUES ('c1', 'dev-app', 'Dev App', '["https://dev.example/callback"]',
      '["openid","offline_access"]', 'owner', 0, 0, '["authorization_code","refresh_token"]')`);
  raw.exec(`INSERT INTO "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
    VALUES ('consent', 'dev-app', 'user-1', '["openid","offline_access"]', '${PAST}', '${PAST}')`);
}

function join(raw: DatabaseSync) {
  raw.exec(`INSERT INTO memberships (user_id, chapter_id, role, status)
    VALUES ('owner', 1, 'member', 'active')`);
}

function leave(raw: DatabaseSync) {
  raw.exec(`DELETE FROM memberships WHERE user_id = 'owner'`);
}

let codes = 0;

function authorize(raw: DatabaseSync) {
  codes += 1;
  const identifier = `code-${codes}`;
  raw
    .prepare(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      identifier,
      identifier,
      JSON.stringify({
        type: "authorization_code",
        query: { client_id: "dev-app", scope: "openid offline_access" },
        userId: "user-1",
      }),
      FUTURE,
      PAST,
      PAST,
    );
  return identifier;
}

function insertTokens(raw: DatabaseSync, code: string, suffix: string) {
  raw
    .prepare(`INSERT INTO "oauthRefreshToken"
      (id, token, "clientId", "userId", "expiresAt", "createdAt", scopes, "authorizationCodeId")
      VALUES (?, ?, 'dev-app', 'user-1', ?, ?, '["openid","offline_access"]', ?)`)
    .run(`r-${suffix}`, `refresh-${suffix}`, FUTURE, PAST, code);
  raw
    .prepare(`INSERT INTO "oauthAccessToken"
      (id, token, "clientId", "userId", "refreshId", "expiresAt", "createdAt", scopes,
       "authorizationCodeId")
      VALUES (?, ?, 'dev-app', 'user-1', ?, ?, ?, '["openid","offline_access"]', ?)`)
    .run(`a-${suffix}`, `access-${suffix}`, `r-${suffix}`, FUTURE, PAST, code);
}

function client(raw: DatabaseSync, clientId = "dev-app") {
  return raw
    .prepare(`SELECT disabled, scopes FROM "oauthClient" WHERE "clientId" = ?`)
    .get(clientId) as { disabled: number; scopes: string } | undefined;
}

function count(raw: DatabaseSync, table: string) {
  return (raw.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.requireUser.mockResolvedValue({ id: "owner", email: "owner@example.com" });
});

describe("a console request that passed the membership check (A1)", () => {
  it("does not create a client when the owner's last membership ends before the insert", async () => {
    const { raw, env, onMembershipRead } = migratedDb();
    seed(raw);
    onMembershipRead(() => leave(raw));

    const refusal = await createDeveloperClient(env, request(), {
      name: "Late",
      redirectUris: ["https://late.example/callback"],
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(Response);
    expect((refusal as Response).status).toBe(403);
    expect(await (refusal as Response).text()).toBe("Forbidden");

    expect(count(raw, "oauthClient")).toBe(2);
    expect(client(raw)?.disabled).toBe(1);
  });

  it("does not enable a client when the owner's last membership ends before the update", async () => {
    const { raw, env, onMembershipRead } = migratedDb();
    seed(raw);
    raw.exec(`UPDATE "oauthClient" SET disabled = 1 WHERE "clientId" = 'dev-app'`);
    onMembershipRead(() => leave(raw));

    await expect(setDeveloperClientEnabled(env, request(), "dev-app", true)).rejects.toMatchObject({
      status: 403,
    });

    expect(client(raw)?.disabled).toBe(1);
  });

  it("still lets a member create and enable a client, and anyone disable one", async () => {
    const { raw, env } = migratedDb();
    seed(raw);

    const created = await createDeveloperClient(env, request(), {
      name: "Fresh",
      redirectUris: ["https://fresh.example/callback"],
    });
    expect(client(raw, created.client.clientId)?.disabled).toBe(0);

    await setDeveloperClientEnabled(env, request(), "dev-app", false);
    expect(client(raw)?.disabled).toBe(1);
    await setDeveloperClientEnabled(env, request(), "dev-app", true);
    expect(client(raw)?.disabled).toBe(0);
  });

  it("answers 404, not 403, when a member's client disappears before the update", async () => {
    const { raw, env, onClientRead } = migratedDb();
    seed(raw);
    raw.exec(`UPDATE "oauthClient" SET disabled = 1 WHERE "clientId" = 'dev-app'`);
    onClientRead(() => {
      raw.exec(`DELETE FROM "oauthClient" WHERE "clientId" = 'dev-app'`);
    });

    await expect(setDeveloperClientEnabled(env, request(), "dev-app", true)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("a token write decided before a revocation (A2)", () => {
  it("refuses tokens inserted after the owner lost membership, also after they return", async () => {
    const { raw, env } = migratedDb();
    seed(raw);
    const code = authorize(raw);

    leave(raw);
    expect(() => insertTokens(raw, code, "late")).toThrow(REVOKED);

    join(raw);
    await setDeveloperClientEnabled(env, request(), "dev-app", true);
    expect(() => insertTokens(raw, code, "later")).toThrow(REVOKED);
    expect(count(raw, "oauthAccessToken")).toBe(0);
    expect(count(raw, "oauthRefreshToken")).toBe(0);
  });

  it("refuses tokens inserted after the owner disabled the client, also after re-enabling", async () => {
    const { raw, env } = migratedDb();
    seed(raw);
    const code = authorize(raw);
    const pending = authorize(raw);
    insertTokens(raw, code, "before");

    await setDeveloperClientEnabled(env, request(), "dev-app", false);
    expect(count(raw, "oauthAccessToken")).toBe(0);
    expect(count(raw, "oauthRefreshToken")).toBe(0);
    expect(count(raw, "verification")).toBe(0);
    expect(() => insertTokens(raw, code, "late")).toThrow(REVOKED);

    await setDeveloperClientEnabled(env, request(), "dev-app", true);
    expect(() => insertTokens(raw, code, "rotated")).toThrow(REVOKED);
    expect(() => insertTokens(raw, pending, "pending")).toThrow(REVOKED);
  });

  it("never records a code issued while the client is disabled", async () => {
    const { raw, env } = migratedDb();
    seed(raw);
    await setDeveloperClientEnabled(env, request(), "dev-app", false);
    const code = authorize(raw);

    await setDeveloperClientEnabled(env, request(), "dev-app", true);

    expect(count(raw, "developerClientGrantCode")).toBe(0);
    expect(() => insertTokens(raw, code, "late")).toThrow(REVOKED);
  });

  it("refuses tokens of a grant from before a scope change and keeps grants otherwise", async () => {
    const { raw, env } = migratedDb();
    seed(raw);
    const code = authorize(raw);
    const input = { name: "Dev App", redirectUris: ["https://dev.example/callback"] };

    await updateDeveloperClient(env, request(), "dev-app", {
      ...input,
      scopes: ["openid", "offline_access"],
    });
    insertTokens(raw, code, "same-scopes");

    await updateDeveloperClient(env, request(), "dev-app", { ...input, scopes: ["openid"] });
    expect(count(raw, "oauthAccessToken")).toBe(0);
    expect(() => insertTokens(raw, code, "late")).toThrow(REVOKED);

    const fresh = authorize(raw);
    insertTokens(raw, fresh, "fresh");
    expect(count(raw, "oauthAccessToken")).toBe(1);
  });

  it("issues tokens again for a new authorization after the owner returns", async () => {
    const { raw, env } = migratedDb();
    seed(raw);
    leave(raw);
    join(raw);
    await setDeveloperClientEnabled(env, request(), "dev-app", true);

    insertTokens(raw, authorize(raw), "new");

    expect(count(raw, "oauthAccessToken")).toBe(1);
  });
});

describe("migration 0026", () => {
  it("disables clients of owners without membership and purges disabled clients' grants", () => {
    const { raw, finishMigrations } = migratedDb({ stopBefore: REVOCATION_MIGRATION });
    seed(raw);
    raw.exec(`INSERT INTO "user" (id, name, email) VALUES ('gone', 'Gone', 'gone@example.com')`);
    raw.exec(`INSERT INTO "oauthClient"
      (id, "clientId", name, "redirectUris", "userId", disabled, "skipConsent")
      VALUES
      ('c2', 'orphan', 'Orphan', '[]', 'gone', 0, 0),
      ('c3', 'off', 'Off', '[]', 'owner', 1, 0),
      ('c4', 'first-party', 'Wiki', '[]', NULL, 0, 1)`);
    const code = authorize(raw);
    insertTokens(raw, code, "kept");
    raw.exec(`INSERT INTO "developerClientGrantCode"
      ("authorizationCodeId", "userId", "clientId", "createdAt")
      VALUES ('off-code', 'user-1', 'off', '${PAST}')`);

    finishMigrations();

    expect(
      raw.prepare(`SELECT "clientId", disabled FROM "oauthClient" ORDER BY "clientId"`).all(),
    ).toEqual([
      { clientId: "dev-app", disabled: 0 },
      { clientId: "first-party", disabled: 0 },
      { clientId: "gdg-cli", disabled: 0 },
      { clientId: "off", disabled: 1 },
      { clientId: "orphan", disabled: 1 },
    ]);
    expect(count(raw, "oauthAccessToken")).toBe(1);
    expect(raw.prepare(`SELECT "clientId" FROM "developerClientGrantCode"`).all()).toEqual([
      { clientId: "dev-app" },
    ]);
  });
});
