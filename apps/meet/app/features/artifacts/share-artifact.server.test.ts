import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { MeetingInviteeRecord, MeetingRecord } from "~/features/meetings/meeting";
import type { ArtifactRecord } from "./artifact";
import { shareArtifactJob } from "./share-artifact.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

const ACTIVE_MEETING: MeetingRecord = {
  id: "mtg-1",
  hostChapterId: 1,
  title: "定例会議",
  description: "",
  startAt: "2026-11-19T10:00:00.000Z",
  endAt: "2026-11-19T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "RESTRICTED",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/space-1",
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

const BASE_ARTIFACT: ArtifactRecord = {
  id: "art-1",
  meetingId: "mtg-1",
  conferenceRecord: "conferenceRecords/conf-1",
  kind: "recording",
  driveFileId: "drive-file-1",
  title: "定例会議 録画",
  mimeType: "video/mp4",
  webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
  createdAt: "2026-11-19T11:05:00.000Z",
  sharedAt: null,
  attachedAt: null,
  lastError: null,
  attempts: 0,
};

const INVITEES: MeetingInviteeRecord[] = [
  {
    meetingId: "mtg-1",
    emailNormalized: "ab@gmail.com",
    email: "a.b@gmail.com",
    displayName: "Dot Gmail",
    userId: "u-1",
    role: "cohost",
    sourceKinds: ["creator"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "guest@example.com",
    email: "guest@example.com",
    displayName: "Guest User",
    userId: "u-2",
    role: "participant",
    sourceKinds: ["email"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "another@example.com",
    email: "another@example.com",
    displayName: "Another User",
    userId: "u-3",
    role: "participant",
    sourceKinds: ["email"],
  },
];

function createFakeShareDb(
  connection: GoogleConnectionRow,
  meeting: MeetingRecord | null,
  artifact: ArtifactRecord | null,
  invitees: MeetingInviteeRecord[],
) {
  let currentArtifact = artifact ? { ...artifact } : null;

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
            return connection as T;
          }
          if (sql.includes("FROM artifacts WHERE id = ?")) {
            if (!currentArtifact) return null;
            return {
              id: currentArtifact.id,
              meeting_id: currentArtifact.meetingId,
              conference_record: currentArtifact.conferenceRecord,
              kind: currentArtifact.kind,
              drive_file_id: currentArtifact.driveFileId,
              title: currentArtifact.title,
              mime_type: currentArtifact.mimeType,
              web_view_link: currentArtifact.webViewLink,
              created_at: currentArtifact.createdAt,
              shared_at: currentArtifact.sharedAt,
              attached_at: currentArtifact.attachedAt,
              last_error: currentArtifact.lastError,
              attempts: currentArtifact.attempts,
            } as T;
          }
          if (sql.includes("FROM meetings WHERE id = ?")) {
            if (!meeting) return null;
            return {
              id: meeting.id,
              host_chapter_id: meeting.hostChapterId,
              title: meeting.title,
              description: meeting.description,
              start_at: meeting.startAt,
              end_at: meeting.endAt,
              time_zone: meeting.timeZone,
              access_type: meeting.accessType,
              auto_transcription: meeting.autoTranscription ? 1 : 0,
              auto_smart_notes: meeting.autoSmartNotes ? 1 : 0,
              auto_recording: meeting.autoRecording ? 1 : 0,
              space_name: meeting.spaceName,
              meeting_uri: meeting.meetingUri,
              meeting_code: meeting.meetingCode,
              calendar_event_id: meeting.calendarEventId,
              calendar_html_link: meeting.calendarHtmlLink,
              status: meeting.status,
              last_error: meeting.lastError,
              created_by_user_id: meeting.createdByUserId,
              created_by_email: meeting.createdByEmail,
              created_at: meeting.createdAt,
              updated_at: meeting.updatedAt,
              canceled_at: meeting.canceledAt,
            } as T;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async all<T>() {
          if (sql.includes("FROM meeting_invitees")) {
            return {
              results: invitees.map((inv) => ({
                meeting_id: inv.meetingId,
                email_normalized: inv.emailNormalized,
                email: inv.email,
                display_name: inv.displayName,
                user_id: inv.userId,
                role: inv.role,
                source_kinds: JSON.stringify(inv.sourceKinds),
              })) as T[],
            };
          }
          throw new Error(`未対応の all(): ${sql}`);
        },
        async run() {
          if (sql.includes("SET shared_at = ?, last_error = ?")) {
            const [sharedAt, lastError] = args as [string, string | null];
            if (currentArtifact) {
              currentArtifact = { ...currentArtifact, sharedAt, lastError };
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET attached_at = ?")) {
            const [attachedAt] = args as [string];
            if (currentArtifact) {
              currentArtifact = { ...currentArtifact, attachedAt };
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("SET attempts = attempts + 1, last_error = ?")) {
            const [lastError] = args as [string];
            if (currentArtifact) {
              currentArtifact = {
                ...currentArtifact,
                attempts: currentArtifact.attempts + 1,
                lastError,
              };
            }
            return { success: true, meta: { changes: 1 } };
          }
          throw new Error(`未対応の run(): ${sql}`);
        },
      };
      return stmt;
    },
  };

  return {
    db: db as unknown as D1Database,
    getArtifact: () => currentArtifact,
  };
}

async function createEnvFixture(
  meeting: MeetingRecord | null = ACTIVE_MEETING,
  artifact: ArtifactRecord | null = BASE_ARTIFACT,
  invitees: MeetingInviteeRecord[] = INVITEES,
) {
  const encrypted = await encryptRefreshToken(
    { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
    GOOGLE_CONNECTION_AAD,
    "1//0g-share-refresh",
  );
  const connection: GoogleConnectionRow = {
    id: 1,
    email: HOST_EMAIL,
    google_user_id: "110111222333",
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
  const dbFixture = createFakeShareDb(connection, meeting, artifact, invitees);
  const env = {
    DB: dbFixture.db,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
  } as unknown as Env;
  return { env, ...dbFixture };
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("shareArtifactJob", () => {
  it("ドット付き Gmail を正規化照合して重複共有を避け、既存権限に触れず、既存添付を残して attachments のみ sendUpdates=none で patch する", async () => {
    const { env, getArtifact } = await createEnvFixture();
    const sharedEmails: string[] = [];
    let deleteOrPatchPermissionCalled = false;
    let calendarPatchUrl = "";
    let calendarPatchBody: Record<string, unknown> | null = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.share", expires_in: 3600 });
      }
      if (url.includes("/drive/v3/files/drive-file-1/permissions") && method === "GET") {
        return Response.json({
          permissions: [
            { id: "p-owner", type: "user", role: "owner", emailAddress: HOST_EMAIL },
            // ドットなし異表記で既に共有済み → a.b@gmail.com への重複 createPermission を呼ばない
            { id: "p-dot", type: "user", role: "reader", emailAddress: "ab@gmail.com" },
            // 手動共有済みの外部アカウント → 決して変更・削除しない
            { id: "p-manual", type: "user", role: "writer", emailAddress: "manual@example.com" },
          ],
        });
      }
      if (url.includes("/drive/v3/files/drive-file-1/permissions") && method === "POST") {
        expect(new URL(url).searchParams.get("sendNotificationEmail")).toBe("false");
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        sharedEmails.push(body.emailAddress);
        return Response.json({ id: `perm-${sharedEmails.length}`, ...body });
      }
      if (
        url.includes("/drive/v3/files/drive-file-1/permissions") &&
        (method === "DELETE" || method === "PATCH")
      ) {
        deleteOrPatchPermissionCalled = true;
        return new Response(null, { status: 204 });
      }
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "GET") {
        return Response.json({
          id: "evt-1",
          attachments: [
            {
              fileUrl: "https://docs.google.com/document/d/existing-agenda/edit",
              title: "アジェンダ",
              mimeType: "application/vnd.google-apps.document",
            },
          ],
        });
      }
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "PATCH") {
        calendarPatchUrl = url;
        calendarPatchBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "evt-1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await shareArtifactJob(env, "art-1", {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-19T12:00:00.000Z"),
    });

    expect(sharedEmails).toEqual(["guest@example.com", "another@example.com"]);
    expect(deleteOrPatchPermissionCalled).toBe(false);

    const parsedPatchUrl = new URL(calendarPatchUrl);
    expect(parsedPatchUrl.searchParams.get("supportsAttachments")).toBe("true");
    expect(parsedPatchUrl.searchParams.get("sendUpdates")).toBe("none");
    // attachments 以外の項目（attendees やゲスト可視性 3 項目など）を変更しないことを厳密に固定する。
    expect(Object.keys(calendarPatchBody ?? {})).toEqual(["attachments"]);
    expect(calendarPatchBody).toEqual({
      attachments: [
        {
          fileUrl: "https://docs.google.com/document/d/existing-agenda/edit",
          title: "アジェンダ",
          mimeType: "application/vnd.google-apps.document",
        },
        {
          fileUrl: "https://drive.google.com/file/d/drive-file-1/view",
          title: "録画",
          mimeType: "video/mp4",
        },
      ],
    });
    expect(getArtifact()).toMatchObject({
      sharedAt: "2026-11-19T12:00:00.000Z",
      attachedAt: "2026-11-19T12:00:00.000Z",
      lastError: null,
      attempts: 0,
    });
  });

  it("種別ごとの短い Calendar 表示名（要約・文字起こし / 録画 / チャットの記録）で添付し、Drive ファイル名は変更しない", async () => {
    const cases = [
      {
        kind: "notes" as const,
        driveTitle: "abc-defg-hij (2026-11-19 19:00 GMT+9) - Gemini が作成したメモ",
        mimeType: "application/vnd.google-apps.document",
        webViewLink: "https://docs.google.com/document/d/drive-notes-1/edit",
        expectedCalendarTitle: "要約・文字起こし",
      },
      {
        kind: "recording" as const,
        driveTitle: "abc-defg-hij (2026-11-19 19:00 GMT+9) - 録画",
        mimeType: "video/mp4",
        webViewLink: "https://drive.google.com/file/d/drive-rec-1/view",
        expectedCalendarTitle: "録画",
      },
      {
        kind: "chat_log" as const,
        driveTitle: "abc-defg-hij (2026-11-19 19:00 GMT+9) - チャットの記録",
        mimeType: "text/plain",
        webViewLink: "https://drive.google.com/file/d/drive-chat-1/view",
        expectedCalendarTitle: "チャットの記録",
      },
    ];

    for (const c of cases) {
      const { env } = await createEnvFixture(ACTIVE_MEETING, {
        ...BASE_ARTIFACT,
        kind: c.kind,
        driveFileId: `drive-${c.kind}-1`,
        title: c.driveTitle,
        mimeType: c.mimeType,
        webViewLink: c.webViewLink,
      });

      let patchedTitle: string | undefined;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "ya29.share", expires_in: 3600 });
        }
        if (url.includes("/permissions") && method === "GET") {
          return Response.json({ permissions: [] });
        }
        if (url.includes("/permissions") && method === "POST") {
          return Response.json({ id: "perm-1" });
        }
        if (url.includes("/calendar/v3/") && method === "GET") {
          return Response.json({ id: "evt-1", attachments: [] });
        }
        if (url.includes("/calendar/v3/") && method === "PATCH") {
          const body = JSON.parse(String(init?.body)) as {
            attachments?: Array<{ title?: string }>;
          };
          patchedTitle = body.attachments?.[0]?.title;
          return Response.json({ id: "evt-1" });
        }
        throw new Error(`想定外の fetch: ${method} ${url}`);
      }) as unknown as typeof fetch;

      await shareArtifactJob(env, "art-1", { fetchFn: fetchMock });
      expect(patchedTitle).toBe(c.expectedCalendarTitle);
    }
  });

  it("1 人の恒久的 400 エラーでは他の招待者への共有を継続して shared_at を入れ、レート制限の 403 は再試行へ回す", async () => {
    const { env, getArtifact } = await createEnvFixture();
    const sharedEmails: string[] = [];

    const fetchPermanent = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.share", expires_in: 3600 });
      }
      if (url.includes("/permissions") && method === "GET") {
        return Response.json({ permissions: [] });
      }
      if (url.includes("/permissions") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { emailAddress: string };
        if (body.emailAddress === "guest@example.com") {
          return Response.json(
            { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid email" } },
            { status: 400 },
          );
        }
        sharedEmails.push(body.emailAddress);
        return Response.json({ id: "perm-ok", ...body });
      }
      if (url.includes("/calendar/v3/") && method === "GET") {
        return Response.json({ id: "evt-1", attachments: [] });
      }
      if (url.includes("/calendar/v3/") && method === "PATCH") {
        return Response.json({ id: "evt-1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    await shareArtifactJob(env, "art-1", {
      fetchFn: fetchPermanent,
      now: () => new Date("2026-11-19T12:10:00.000Z"),
    });

    expect(sharedEmails).toEqual(["a.b@gmail.com", "another@example.com"]);
    expect(getArtifact()?.sharedAt).toBe("2026-11-19T12:10:00.000Z");
    expect(getArtifact()?.attachedAt).toBe("2026-11-19T12:10:00.000Z");
    expect(getArtifact()?.lastError).toContain("400");
    expect(getArtifact()?.lastError).not.toContain("guest@example.com");

    // 403 sharingRateLimitExceeded は恒久エラー扱いせず再試行のため例外を再スローする。
    const rateLimitFixture = await createEnvFixture();
    const fetchRateLimit = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.share", expires_in: 3600 });
      }
      if (url.includes("/permissions") && method === "GET") {
        return Response.json({ permissions: [] });
      }
      return Response.json(
        {
          error: {
            code: 403,
            message: "Rate limit exceeded",
            errors: [{ domain: "global", reason: "sharingRateLimitExceeded" }],
          },
        },
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    await expect(
      shareArtifactJob(rateLimitFixture.env, "art-1", { fetchFn: fetchRateLimit }),
    ).rejects.toThrow(GoogleApiError);
    expect(rateLimitFixture.getArtifact()?.sharedAt).toBeNull();
    expect(rateLimitFixture.getArtifact()?.attempts).toBe(1);
    expect(rateLimitFixture.getArtifact()?.lastError).toContain("sharingRateLimitExceeded");
  });

  it("canceled 会議の artifact は共有・添付せず即終了する", async () => {
    const { env } = await createEnvFixture({ ...ACTIVE_MEETING, status: "canceled" });
    const fetchMock = vi.fn() as unknown as typeof fetch;

    await shareArtifactJob(env, "art-1", { fetchFn: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
