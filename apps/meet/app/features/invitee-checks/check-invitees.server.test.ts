import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import {
  DRIVE_PROBE_FILE_MIME_TYPE,
  DRIVE_PROBE_FILE_NAME,
  MAX_DRIVE_PROBE_PER_SAVE,
  findUnshareableInvitees,
  formatUnshareableInviteesError,
} from "./check-invitees.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

function createTestDb(
  connection: GoogleConnectionRow,
  options: { oidcSubject?: string | null } = {},
) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY,
      oidc_subject TEXT
    );
    CREATE TABLE google_connection (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      google_user_id TEXT NOT NULL,
      refresh_token_ciphertext TEXT NOT NULL,
      refresh_token_nonce TEXT NOT NULL,
      encryption_key_version INTEGER NOT NULL,
      scope TEXT NOT NULL,
      connected_by_user_id TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT
    );
    CREATE TABLE drive_share_checks (
      email_normalized TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('ok', 'unshareable')),
      http_status INTEGER,
      api_status TEXT,
      source TEXT NOT NULL CHECK (source IN ('probe', 'share')),
      checked_at TEXT NOT NULL
    );
    CREATE TABLE drive_probe_file (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      file_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  raw
    .prepare('INSERT INTO "user" (id, oidc_subject) VALUES (?, ?)')
    .run("u-actor", options.oidcSubject === undefined ? "accounts-u-actor" : options.oidcSubject);

  raw
    .prepare(
      `INSERT INTO google_connection (
        id, email, google_user_id, refresh_token_ciphertext, refresh_token_nonce,
        encryption_key_version, scope, connected_by_user_id, connected_at, updated_at,
        status, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      connection.id,
      connection.email,
      connection.google_user_id,
      connection.refresh_token_ciphertext,
      connection.refresh_token_nonce,
      connection.encryption_key_version,
      connection.scope,
      connection.connected_by_user_id,
      connection.connected_at,
      connection.updated_at,
      connection.status,
      connection.last_error,
    );

  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) }),
    run: async () => {
      const info = raw.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });

  const db = {
    prepare: (sql: string) => statement(sql),
  } as unknown as D1Database;

  return { raw, db };
}

async function createEnvFixture(
  options: {
    oidcSubject?: string | null;
    listRegisteredEmails?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-check-refresh",
  );
  const connection: GoogleConnectionRow = {
    id: 1,
    email: HOST_EMAIL,
    google_user_id: "110999888777",
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_nonce: encrypted.nonce,
    encryption_key_version: encrypted.keyVersion,
    scope: "https://www.googleapis.com/auth/drive",
    connected_by_user_id: "admin-1",
    connected_at: "2026-11-19T00:00:00.000Z",
    updated_at: "2026-11-19T00:00:00.000Z",
    status: "connected",
    last_error: null,
  };
  const { raw, db } = createTestDb(connection, { oidcSubject: options.oidcSubject });
  const listRegisteredEmails =
    options.listRegisteredEmails ?? vi.fn().mockResolvedValue({ ok: true, emails: [] });

  const env = {
    DB: db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
    ACCOUNTS_DIRECTORY: { listRegisteredEmails },
  } as unknown as Env;

  return { env, raw, listRegisteredEmails };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("findUnshareableInvitees", () => {
  it("キャッシュの ok（30 日以内）をスキップし、unshareable は登録済み・userId ありでも確かめ直して拒否する", async () => {
    const listRegisteredEmails = vi.fn().mockResolvedValue({
      ok: true,
      emails: ["cached-bad@example.com"],
    });
    const { env, raw } = await createEnvFixture({ listRegisteredEmails });

    raw
      .prepare(
        `INSERT INTO drive_share_checks (email_normalized, status, http_status, api_status, source, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("cached-ok@example.com", "ok", null, null, "probe", "2026-11-01T00:00:00.000Z");
    raw
      .prepare(
        `INSERT INTO drive_share_checks (email_normalized, status, http_status, api_status, source, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "cached-bad@example.com",
        "unshareable",
        400,
        "invalidSharingRequest",
        "share",
        "2026-10-01T00:00:00.000Z",
      );
    raw
      .prepare("INSERT INTO drive_probe_file (id, file_id, created_at) VALUES (1, ?, ?)")
      .run("probe-1", "2026-10-01T00:00:00.000Z");

    const probedEmails: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.includes("/files/probe-1/permissions?") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        probedEmails.push(body.emailAddress);
        return Response.json(
          {
            error: {
              code: 400,
              message: "Bad Request.",
              errors: [{ domain: "global", reason: "invalidSharingRequest" }],
            },
          },
          { status: 400 },
        );
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const unshareable = await findUnshareableInvitees(
      env,
      {
        actorLocalUserId: "u-actor",
        invitees: [
          { emailNormalized: HOST_EMAIL, email: HOST_EMAIL, userId: null },
          { emailNormalized: "existing@example.com", email: "existing@example.com", userId: null },
          {
            emailNormalized: "cached-ok@example.com",
            email: "Cached-Ok@example.com",
            userId: null,
          },
          {
            emailNormalized: "cached-bad@example.com",
            email: "Cached-Bad@example.com",
            userId: "u-1",
          },
        ],
        existingInvitees: [{ emailNormalized: "existing@example.com" }],
      },
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-20T00:00:00.000Z"),
      },
    );

    expect(unshareable).toEqual([
      { emailNormalized: "cached-bad@example.com", email: "Cached-Bad@example.com" },
    ]);
    expect(formatUnshareableInviteesError(unshareable)).toBe(
      "Google アカウントとして共有できないメールアドレスが含まれています: Cached-Bad@example.com。アドレスを確認するか、招待先から外してください。",
    );
    expect(listRegisteredEmails).not.toHaveBeenCalled();
    expect(probedEmails).toEqual(["Cached-Bad@example.com"]);
  });

  it("unshareable キャッシュは確かめ直しで共有できれば通し、一時エラーなら拒否のまま扱う", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, raw } = await createEnvFixture();
    const insertCheck = raw.prepare(
      `INSERT INTO drive_share_checks (email_normalized, status, http_status, api_status, source, checked_at)
       VALUES (?, 'unshareable', 400, 'invalidSharingRequest', 'probe', '2026-10-01T00:00:00.000Z')`,
    );
    insertCheck.run("now-google@example.com");
    insertCheck.run("flaky@example.com");
    raw
      .prepare("INSERT INTO drive_probe_file (id, file_id, created_at) VALUES (1, ?, ?)")
      .run("probe-1", "2026-10-01T00:00:00.000Z");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.includes("/files/probe-1/permissions?") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        if (body.emailAddress === "flaky@example.com") {
          return Response.json(
            { error: { code: 503, status: "UNAVAILABLE", message: "Backend Error" } },
            { status: 503 },
          );
        }
        return Response.json({ id: "perm-now" });
      }
      if (url.endsWith("/files/probe-1/permissions/perm-now") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const unshareable = await findUnshareableInvitees(
      env,
      {
        actorLocalUserId: "u-actor",
        invitees: [
          {
            emailNormalized: "now-google@example.com",
            email: "now-google@example.com",
            userId: null,
          },
          { emailNormalized: "flaky@example.com", email: "flaky@example.com", userId: null },
        ],
      },
      { fetchFn: fetchMock, now: () => new Date("2026-11-20T00:00:00.000Z") },
    );

    expect(unshareable).toEqual([
      { emailNormalized: "flaky@example.com", email: "flaky@example.com" },
    ]);
    const statuses = raw
      .prepare("SELECT email_normalized, status FROM drive_share_checks ORDER BY email_normalized")
      .all();
    expect(statuses).toEqual([
      { email_normalized: "flaky@example.com", status: "unshareable" },
      { email_normalized: "now-google@example.com", status: "ok" },
    ]);
    warnSpy.mockRestore();
  });

  it("userId ありと Accounts 登録済みアドレスは Drive 確認をスキップし、30 日超の ok キャッシュは再確認する", async () => {
    const listRegisteredEmails = vi.fn().mockResolvedValue({
      ok: true,
      emails: ["registered@example.com"],
    });
    const { env, raw } = await createEnvFixture({ listRegisteredEmails });

    raw
      .prepare(
        `INSERT INTO drive_share_checks (email_normalized, status, http_status, api_status, source, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("stale-ok@example.com", "ok", null, null, "probe", "2026-10-01T00:00:00.000Z");
    raw
      .prepare("INSERT INTO drive_probe_file (id, file_id, created_at) VALUES (1, ?, ?)")
      .run("probe-existing-1", "2026-10-01T00:00:00.000Z");

    const probedEmails: string[] = [];
    const deletedPermIds: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.includes("/drive/v3/files/probe-existing-1/permissions") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        probedEmails.push(body.emailAddress);
        return Response.json({ id: "perm-123", type: "user", role: "reader" });
      }
      if (
        url.includes("/drive/v3/files/probe-existing-1/permissions/perm-123") &&
        method === "DELETE"
      ) {
        deletedPermIds.push("perm-123");
        return new Response(null, { status: 204 });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const unshareable = await findUnshareableInvitees(
      env,
      {
        actorLocalUserId: "u-actor",
        invitees: [
          { emailNormalized: "member@example.com", email: "member@example.com", userId: "u-mem" },
          {
            emailNormalized: "registered@example.com",
            email: "registered@example.com",
            userId: null,
          },
          { emailNormalized: "stale-ok@example.com", email: "Stale-Ok@example.com", userId: null },
        ],
      },
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-20T00:00:00.000Z"),
      },
    );

    expect(unshareable).toEqual([]);
    expect(listRegisteredEmails).toHaveBeenCalledWith({
      actorUserId: "accounts-u-actor",
      emails: ["registered@example.com", "stale-ok@example.com"],
    });
    expect(probedEmails).toEqual(["Stale-Ok@example.com"]);
    expect(deletedPermIds).toEqual(["perm-123"]);

    const cached = raw
      .prepare(
        "SELECT status, source, checked_at FROM drive_share_checks WHERE email_normalized = ?",
      )
      .get("stale-ok@example.com") as { status: string; source: string; checked_at: string };
    expect(cached).toEqual({
      status: "ok",
      source: "probe",
      checked_at: "2026-11-20T00:00:00.000Z",
    });
  });

  it("RPC が失敗（不明）時は Drive で確認し、確認用ファイル作成・400 拒否・権限削除を行う", async () => {
    const listRegisteredEmails = vi.fn().mockRejectedValue(new Error("RPC unavailable"));
    const { env, raw } = await createEnvFixture({ listRegisteredEmails });

    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${new URL(url).pathname}`);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { name: string; mimeType: string };
        expect(body).toEqual({
          name: DRIVE_PROBE_FILE_NAME,
          mimeType: DRIVE_PROBE_FILE_MIME_TYPE,
        });
        return Response.json({ id: "created-probe-1" });
      }
      if (url.includes("/files/created-probe-1/permissions?") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        if (body.emailAddress === "NoGoogle@example.com") {
          return Response.json(
            {
              error: {
                code: 400,
                message:
                  'Bad Request. User message: "Sorry, cannot share with NoGoogle@example.com."',
                errors: [{ domain: "global", reason: "invalidSharingRequest" }],
              },
            },
            { status: 400 },
          );
        }
        return Response.json({ id: "perm-good" });
      }
      if (url.endsWith("/files/created-probe-1/permissions/perm-good") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const unshareable = await findUnshareableInvitees(
      env,
      {
        actorLocalUserId: "u-actor",
        invitees: [
          { emailNormalized: "good@example.com", email: "Good@example.com", userId: null },
          { emailNormalized: "nogoogle@example.com", email: "NoGoogle@example.com", userId: null },
        ],
      },
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-20T01:00:00.000Z"),
      },
    );

    expect(unshareable).toEqual([
      { emailNormalized: "nogoogle@example.com", email: "NoGoogle@example.com" },
    ]);
    expect(calls).toEqual([
      "POST /token",
      "POST /drive/v3/files",
      "POST /drive/v3/files/created-probe-1/permissions",
      "DELETE /drive/v3/files/created-probe-1/permissions/perm-good",
      "POST /drive/v3/files/created-probe-1/permissions",
    ]);

    const probeRow = raw.prepare("SELECT file_id FROM drive_probe_file WHERE id = 1").get() as {
      file_id: string;
    };
    expect(probeRow.file_id).toBe("created-probe-1");

    const badRow = raw
      .prepare(
        "SELECT status, http_status, api_status, source FROM drive_share_checks WHERE email_normalized = ?",
      )
      .get("nogoogle@example.com") as Record<string, unknown>;
    expect(badRow).toEqual({
      status: "unshareable",
      http_status: 400,
      api_status: "invalidSharingRequest",
      source: "probe",
    });
  });

  it("確認用ファイルが 404 を返したときは作り直して再試行する", async () => {
    const { env, raw } = await createEnvFixture();
    raw
      .prepare("INSERT INTO drive_probe_file (id, file_id, created_at) VALUES (1, ?, ?)")
      .run("deleted-probe", "2026-10-01T00:00:00.000Z");

    let createCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.includes("/files/deleted-probe/permissions") && method === "POST") {
        return Response.json(
          { error: { code: 404, status: "NOT_FOUND", message: "File not found" } },
          { status: 404 },
        );
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && method === "POST") {
        createCount += 1;
        return Response.json({ id: "recreated-probe-2" });
      }
      if (url.includes("/files/recreated-probe-2/permissions?") && method === "POST") {
        return Response.json({ id: "perm-recreated" });
      }
      if (
        url.endsWith("/files/recreated-probe-2/permissions/perm-recreated") &&
        method === "DELETE"
      ) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const unshareable = await findUnshareableInvitees(
      env,
      {
        actorLocalUserId: "u-actor",
        invitees: [{ emailNormalized: "a@example.com", email: "a@example.com", userId: null }],
      },
      { fetchFn: fetchMock, now: () => new Date("2026-11-20T02:00:00.000Z") },
    );

    expect(unshareable).toEqual([]);
    expect(createCount).toBe(1);
    const probeRow = raw.prepare("SELECT file_id FROM drive_probe_file WHERE id = 1").get() as {
      file_id: string;
    };
    expect(probeRow.file_id).toBe("recreated-probe-2");
  });

  it("5xx / 429 / レート制限 403 / ネットワークエラーは保存を止めずキャッシュもせず、warn のメールを伏せる", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, raw } = await createEnvFixture();
    raw
      .prepare("INSERT INTO drive_probe_file (id, file_id, created_at) VALUES (1, ?, ?)")
      .run("probe-1", "2026-11-01T00:00:00.000Z");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.includes("/permissions") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        if (body.emailAddress === "err500@example.com") {
          return Response.json(
            {
              error: {
                code: 503,
                status: "UNAVAILABLE",
                message: "Backend down for err500@example.com",
              },
            },
            { status: 503 },
          );
        }
        if (body.emailAddress === "err429@example.com") {
          return Response.json(
            { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota" } },
            { status: 429 },
          );
        }
        if (body.emailAddress === "err403@example.com") {
          return Response.json(
            {
              error: {
                code: 403,
                message: "Rate limit",
                errors: [{ reason: "sharingRateLimitExceeded" }],
              },
            },
            { status: 403 },
          );
        }
        throw new Error("network failure for neterr@example.com");
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const unshareable = await findUnshareableInvitees(
      env,
      {
        actorLocalUserId: "u-actor",
        invitees: [
          { emailNormalized: "err500@example.com", email: "err500@example.com", userId: null },
          { emailNormalized: "err429@example.com", email: "err429@example.com", userId: null },
          { emailNormalized: "err403@example.com", email: "err403@example.com", userId: null },
          { emailNormalized: "neterr@example.com", email: "neterr@example.com", userId: null },
        ],
      },
      { fetchFn: fetchMock },
    );

    expect(unshareable).toEqual([]);
    const cachedCount = raw.prepare("SELECT COUNT(*) AS cnt FROM drive_share_checks").get() as {
      cnt: number;
    };
    expect(cachedCount.cnt).toBe(0);

    expect(warnSpy).toHaveBeenCalledTimes(4);
    const allWarnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(allWarnArgs).not.toContain("err500@example.com");
    expect(allWarnArgs).not.toContain("neterr@example.com");
    expect(allWarnArgs).toContain("e***@example.com");
    expect(allWarnArgs).toContain("n***@example.com");
    warnSpy.mockRestore();
  });

  it("1 回の保存で Drive 確認は最大 20 件までに制限し、超過分は確認せず通す", async () => {
    const { env, raw } = await createEnvFixture();
    raw
      .prepare("INSERT INTO drive_probe_file (id, file_id, created_at) VALUES (1, ?, ?)")
      .run("probe-1", "2026-11-01T00:00:00.000Z");

    const probed: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe", expires_in: 3600 });
      }
      if (url.includes("/permissions?") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        probed.push(body.emailAddress);
        return Response.json({ id: `perm-${probed.length}` });
      }
      if (url.includes("/permissions/") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const invitees = Array.from({ length: 25 }, (_, i) => ({
      emailNormalized: `user${i}@example.com`,
      email: `user${i}@example.com`,
      userId: null,
    }));

    const unshareable = await findUnshareableInvitees(
      env,
      { actorLocalUserId: "u-actor", invitees },
      { fetchFn: fetchMock },
    );

    expect(unshareable).toEqual([]);
    expect(probed).toHaveLength(MAX_DRIVE_PROBE_PER_SAVE);
    expect(probed[0]).toBe("user0@example.com");
    expect(probed[19]).toBe("user19@example.com");
  });
});
