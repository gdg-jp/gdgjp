import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { MeetingInviteeRecord, MeetingRecord } from "./meeting";
import { syncMeetingMembers } from "./sync-members.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

function createFakeSyncDb(
  connection: GoogleConnectionRow | null,
  meeting: MeetingRecord | null,
  invitees: MeetingInviteeRecord[],
) {
  let currentMeeting = meeting ? { ...meeting } : null;
  let currentConnection = connection ? { ...connection } : null;
  const inviteeState = invitees.map((inv) => ({ ...inv, googleUser: inv.googleUser ?? null }));

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM google_connection WHERE id = ?")) {
            return currentConnection as T | null;
          }
          if (sql.includes("FROM meetings WHERE id = ?")) {
            if (!currentMeeting) return null;
            return {
              id: currentMeeting.id,
              host_chapter_id: currentMeeting.hostChapterId,
              title: currentMeeting.title,
              description: currentMeeting.description,
              start_at: currentMeeting.startAt,
              end_at: currentMeeting.endAt,
              time_zone: currentMeeting.timeZone,
              access_type: currentMeeting.accessType,
              auto_transcription: currentMeeting.autoTranscription ? 1 : 0,
              auto_smart_notes: currentMeeting.autoSmartNotes ? 1 : 0,
              auto_recording: currentMeeting.autoRecording ? 1 : 0,
              space_name: currentMeeting.spaceName,
              meeting_uri: currentMeeting.meetingUri,
              meeting_code: currentMeeting.meetingCode,
              calendar_event_id: currentMeeting.calendarEventId,
              calendar_html_link: currentMeeting.calendarHtmlLink,
              status: currentMeeting.status,
              last_error: currentMeeting.lastError,
              created_by_user_id: currentMeeting.createdByUserId,
              created_by_email: currentMeeting.createdByEmail,
              created_at: currentMeeting.createdAt,
              updated_at: currentMeeting.updatedAt,
              canceled_at: currentMeeting.canceledAt,
            } as T;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async all<T>() {
          if (sql.includes("FROM meeting_invitees")) {
            return {
              results: inviteeState.map((inv) => ({
                meeting_id: inv.meetingId,
                email_normalized: inv.emailNormalized,
                email: inv.email,
                display_name: inv.displayName,
                user_id: inv.userId,
                role: inv.role,
                source_kinds: JSON.stringify(inv.sourceKinds),
                google_user: inv.googleUser,
              })) as T[],
            };
          }
          throw new Error(`未対応の all(): ${sql}`);
        },
        async run() {
          if (sql.includes("UPDATE meeting_invitees SET google_user = ?")) {
            const [googleUser, meetingId, emailNormalized] = args as [
              string | null,
              string,
              string,
            ];
            for (const inv of inviteeState) {
              if (inv.meetingId === meetingId && inv.emailNormalized === emailNormalized) {
                inv.googleUser = googleUser;
              }
            }
            return { success: true, meta: {} };
          }
          if (sql.includes("SET last_error = ?")) {
            const [lastError, updatedAt] = args as [string | null, string];
            if (currentMeeting) {
              currentMeeting = { ...currentMeeting, lastError, updatedAt };
            }
            return { success: true, meta: {} };
          }
          if (sql.includes("SET status = 'disconnected'")) {
            const [lastError, updatedAt] = args as [string, string];
            if (currentConnection) {
              currentConnection = {
                ...currentConnection,
                status: "disconnected",
                last_error: lastError,
                updated_at: updatedAt,
              };
            }
            return { success: true, meta: {} };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(stmts.map((s) => s.run()));
    },
  };

  return {
    db: db as unknown as D1Database,
    getMeeting: () => currentMeeting,
    getConnection: () => currentConnection,
    getInvitees: () => inviteeState,
  };
}

async function createEnvFixture(meeting: MeetingRecord | null, invitees: MeetingInviteeRecord[]) {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-sync-refresh",
  );
  const connection: GoogleConnectionRow = {
    id: 1,
    email: HOST_EMAIL,
    google_user_id: "110111222333",
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_nonce: encrypted.nonce,
    encryption_key_version: encrypted.keyVersion,
    scope: "https://www.googleapis.com/auth/meetings.space.created",
    connected_by_user_id: "admin-1",
    connected_at: "2026-11-19T00:00:00.000Z",
    updated_at: "2026-11-19T00:00:00.000Z",
    status: "connected",
    last_error: null,
  };

  const dbFixture = createFakeSyncDb(connection, meeting, invitees);
  const env = {
    DB: dbFixture.db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
  } as unknown as Env;
  return { env, ...dbFixture };
}

const ACTIVE_MEETING: MeetingRecord = {
  id: "mtg-1",
  hostChapterId: 1,
  title: "定例",
  description: "",
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "RESTRICTED",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/sync-1",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  calendarEventId: "evt-1",
  calendarHtmlLink: null,
  status: "active",
  lastError: null,
  createdByUserId: "u-1",
  createdByEmail: "cohost@example.com",
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  canceledAt: null,
};

const INVITEES: MeetingInviteeRecord[] = [
  {
    meetingId: "mtg-1",
    emailNormalized: "cohost@example.com",
    email: "cohost@example.com",
    displayName: "Cohost",
    userId: "u-1",
    role: "cohost",
    sourceKinds: ["creator"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "member@gmail.com",
    email: "m.e.m.b.e.r@gmail.com",
    displayName: "Member",
    userId: "u-2",
    role: "participant",
    sourceKinds: ["chapter_all"],
  },
];

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("syncMeetingMembers", () => {
  it("2 回連続で実行したとき、2 回目は members.create / members.delete を一切呼ばない（冪等性）", async () => {
    const { env } = await createEnvFixture(ACTIVE_MEETING, INVITEES);

    // インメモリの Meet スペースメンバー一覧を模倣する。
    let remoteMembers: Array<{ name: string; email: string; role?: string }> = [
      { name: "spaces/sync-1/members/host", email: HOST_EMAIL, role: "COHOST" },
    ];
    let createdCalls = 0;
    let deletedCalls = 0;
    let memberSeq = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sync-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/sync-1/members" && method === "GET") {
        return Response.json({ members: remoteMembers });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/sync-1/members" && method === "POST") {
        createdCalls += 1;
        const body = JSON.parse(String(init?.body)) as { email: string; role?: string };
        // Gmail のドット表記揺れを含めて Meet 側が返すケースも検証する。
        const storedEmail =
          body.email === "m.e.m.b.e.r@gmail.com" ? "member@gmail.com" : body.email;
        const created = {
          name: `spaces/sync-1/members/m-${++memberSeq}`,
          email: storedEmail,
          ...(body.role ? { role: body.role } : {}),
        };
        remoteMembers.push(created);
        return Response.json(created);
      }
      if (
        url.startsWith("https://meet.googleapis.com/v2/spaces/sync-1/members/") &&
        method === "DELETE"
      ) {
        deletedCalls += 1;
        const target = decodeURIComponent(url.replace("https://meet.googleapis.com/v2/", ""));
        remoteMembers = remoteMembers.filter((m) => m.name !== target);
        return new Response(null, { status: 204 });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    // 1 回目: cohost（COHOST）と participant（role 省略）が作成され、ホスト自身は触られない。
    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });
    expect(createdCalls).toBe(2);
    expect(deletedCalls).toBe(0);
    expect(remoteMembers).toEqual([
      { name: "spaces/sync-1/members/host", email: HOST_EMAIL, role: "COHOST" },
      { name: "spaces/sync-1/members/m-1", email: "cohost@example.com", role: "COHOST" },
      { name: "spaces/sync-1/members/m-2", email: "member@gmail.com" },
    ]);

    // 2 回目: 差分ゼロのため create / delete ともに 0 回。
    createdCalls = 0;
    deletedCalls = 0;
    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });
    expect(createdCalls).toBe(0);
    expect(deletedCalls).toBe(0);
  });

  it("役割不一致は delete → create で置き換え、不要メンバーを削除する", async () => {
    const { env } = await createEnvFixture(ACTIVE_MEETING, INVITEES);
    const ops: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sync-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/sync-1/members" && method === "GET") {
        return Response.json({
          members: [
            // cohost だが Meet 側では participant（role なし）→ delete→create 対象
            { name: "spaces/sync-1/members/old-cohost", email: "cohost@example.com" },
            // 既に一致 → 無操作
            { name: "spaces/sync-1/members/keep-member", email: "member@gmail.com" },
            // 招待外 → delete 対象
            { name: "spaces/sync-1/members/stale-user", email: "removed@example.com" },
          ],
        });
      }
      if (method === "DELETE") {
        ops.push(
          `DELETE:${decodeURIComponent(url.replace("https://meet.googleapis.com/v2/", ""))}`,
        );
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init?.body)) as { email: string; role?: string };
        ops.push(`CREATE:${body.email}:${body.role ?? "PARTICIPANT"}`);
        return Response.json({ name: "spaces/sync-1/members/new-1", ...body });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });

    expect(ops).toEqual([
      "DELETE:spaces/sync-1/members/old-cohost",
      "CREATE:cohost@example.com:COHOST",
      "DELETE:spaces/sync-1/members/stale-user",
    ]);
  });

  it("cohost → participant への降格も deleteSpaceMember → createSpaceMember（role なし）の順で実行し、Drive API は呼ばない", async () => {
    const { env } = await createEnvFixture(ACTIVE_MEETING, INVITEES);
    const ops: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sync-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/sync-1/members" && method === "GET") {
        return Response.json({
          members: [
            {
              name: "spaces/sync-1/members/keep-cohost",
              email: "cohost@example.com",
              role: "COHOST",
            },
            // participant へ降格された元 cohost → delete → create(role 省略)
            { name: "spaces/sync-1/members/demoted", email: "member@gmail.com", role: "COHOST" },
          ],
        });
      }
      if (method === "DELETE") {
        ops.push(
          `DELETE:${decodeURIComponent(url.replace("https://meet.googleapis.com/v2/", ""))}`,
        );
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init?.body)) as { email: string; role?: string };
        ops.push(`CREATE:${body.email}:${body.role ?? "PARTICIPANT"}`);
        return Response.json({ name: "spaces/sync-1/members/new-2", ...body });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });

    expect(ops).toEqual([
      "DELETE:spaces/sync-1/members/demoted",
      "CREATE:m.e.m.b.e.r@gmail.com:PARTICIPANT",
    ]);
  });

  it("429 エラー時は meetings.last_error を記録して GoogleApiError を再スローする", async () => {
    const { env, getMeeting } = await createEnvFixture(ACTIVE_MEETING, INVITEES);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sync-token", expires_in: 3600 });
      }
      if (method === "GET") {
        return Response.json({ members: [] });
      }
      return Response.json(
        { error: { status: "RESOURCE_EXHAUSTED", message: "Rate limit exceeded" } },
        { status: 429 },
      );
    }) as unknown as typeof fetch;

    await expect(syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock })).rejects.toThrow(
      GoogleApiError,
    );
    expect(getMeeting()?.lastError).toContain("429");
  });

  it("特定メンバーの恒久的 400 エラーは他メンバーの同期を止めず警告を last_error に残す", async () => {
    const { env, getMeeting } = await createEnvFixture(ACTIVE_MEETING, INVITEES);
    const created: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sync-token", expires_in: 3600 });
      }
      if (method === "GET") {
        return Response.json({ members: [] });
      }
      const body = JSON.parse(String(init?.body)) as { email: string };
      if (body.email === "cohost@example.com") {
        return Response.json(
          { error: { status: "INVALID_ARGUMENT", message: "Invalid member email" } },
          { status: 400 },
        );
      }
      created.push(body.email);
      return Response.json({ name: "spaces/sync-1/members/m-2", email: body.email });
    }) as unknown as typeof fetch;

    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });

    expect(created).toEqual(["m.e.m.b.e.r@gmail.com"]);
    expect(getMeeting()?.lastError).toContain("400");
    // プライバシー保護のため last_error にメールアドレスを漏らさないこと
    expect(getMeeting()?.lastError).not.toContain("cohost@example.com");
  });

  it("canceled または spaceName 未設定の会議は何もしない", async () => {
    const { env } = await createEnvFixture({ ...ACTIVE_MEETING, status: "canceled" }, INVITEES);
    const fetchMock = vi.fn() as unknown as typeof fetch;

    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("メンバー name 末尾が全桁数字なら users/<id>、hex ハッシュなら null を meeting_invitees.google_user へ保存する", async () => {
    const { env, getInvitees } = await createEnvFixture(ACTIVE_MEETING, INVITEES);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.sync-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/sync-1/members" && method === "GET") {
        return Response.json({
          members: [
            {
              name: "spaces/sync-1/members/110222333444",
              email: "cohost@example.com",
              role: "COHOST",
            },
          ],
        });
      }
      if (url === "https://meet.googleapis.com/v2/spaces/sync-1/members" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { email: string };
        return Response.json({
          name: "spaces/sync-1/members/9f86d081884c7d659a2feaa0c55ad015",
          email: body.email,
        });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await syncMeetingMembers(env, "mtg-1", { fetchFn: fetchMock });

    expect(getInvitees().map((inv) => [inv.emailNormalized, inv.googleUser])).toEqual([
      ["cohost@example.com", "users/110222333444"],
      ["member@gmail.com", null],
    ]);
  });
});
