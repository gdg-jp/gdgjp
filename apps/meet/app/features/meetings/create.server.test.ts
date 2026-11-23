import type { MeetActor, MeetDirectoryMember } from "@gdgjp/gdg-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import { createMeeting, previewMeetingInvitees } from "./create.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

type StoredMeeting = {
  id: string;
  host_chapter_id: number;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  access_type: string;
  auto_transcription: number;
  auto_smart_notes: number;
  auto_recording: number;
  space_name: string | null;
  meeting_uri: string | null;
  meeting_code: string | null;
  calendar_event_id: string | null;
  calendar_html_link: string | null;
  status: string;
  last_error: string | null;
  created_by_user_id: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

type StoredSource = {
  id: string;
  meeting_id: string;
  kind: string;
  chapter_id: number | null;
  email: string | null;
  role: string;
  created_at: string;
};

type StoredInvitee = {
  meeting_id: string;
  email_normalized: string;
  email: string;
  display_name: string | null;
  user_id: string | null;
  role: string;
  source_kinds: string;
};

function createFakeMeetingsDb(
  connection: GoogleConnectionRow | null,
  options: {
    shareChecks?: Array<{
      email_normalized: string;
      status: "ok" | "unshareable";
      http_status: number | null;
      api_status: string | null;
      source: "probe" | "share";
      checked_at: string;
    }>;
  } = {},
) {
  const meetings = new Map<string, StoredMeeting>();
  const sources: StoredSource[] = [];
  const invitees: StoredInvitee[] = [];
  const shareChecks = new Map(
    (options.shareChecks ?? []).map((row) => [row.email_normalized, row]),
  );
  let probeFileId: string | null = null;

  type PlannedOp = { sql: string; args: unknown[] };

  function executeOp(op: PlannedOp) {
    const { sql, args } = op;
    if (sql.includes("INSERT INTO meetings")) {
      const [
        id,
        hostChapterId,
        title,
        description,
        startAt,
        endAt,
        timeZone,
        accessType,
        autoTranscription,
        autoSmartNotes,
        autoRecording,
        createdByUserId,
        createdByEmail,
        createdAt,
        updatedAt,
      ] = args as [
        string,
        number,
        string,
        string,
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        string,
        string,
        string,
        string,
      ];
      meetings.set(id, {
        id,
        host_chapter_id: hostChapterId,
        title,
        description,
        start_at: startAt,
        end_at: endAt,
        time_zone: timeZone,
        access_type: accessType,
        auto_transcription: autoTranscription,
        auto_smart_notes: autoSmartNotes,
        auto_recording: autoRecording,
        space_name: null,
        meeting_uri: null,
        meeting_code: null,
        calendar_event_id: null,
        calendar_html_link: null,
        status: "creating",
        last_error: null,
        created_by_user_id: createdByUserId,
        created_by_email: createdByEmail,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: {} };
    }
    if (sql.includes("INSERT INTO meeting_invite_sources")) {
      const [id, meetingId, kind, chapterId, email, role, createdAt] = args as [
        string,
        string,
        string,
        number | null,
        string | null,
        string,
        string,
      ];
      sources.push({
        id,
        meeting_id: meetingId,
        kind,
        chapter_id: chapterId,
        email,
        role,
        created_at: createdAt,
      });
      return { success: true, meta: {} };
    }
    if (sql.includes("INSERT INTO meeting_invitees")) {
      const [meetingId, emailNormalized, email, displayName, userId, role, sourceKinds] = args as [
        string,
        string,
        string,
        string | null,
        string | null,
        string,
        string,
      ];
      invitees.push({
        meeting_id: meetingId,
        email_normalized: emailNormalized,
        email,
        display_name: displayName,
        user_id: userId,
        role,
        source_kinds: sourceKinds,
      });
      return { success: true, meta: {} };
    }
    if (sql.includes("SET space_name = ?, meeting_uri = ?, meeting_code = ?")) {
      const [spaceName, meetingUri, meetingCode, updatedAt, id] = args as [
        string,
        string,
        string,
        string,
        string,
      ];
      const existing = meetings.get(id);
      if (existing) {
        existing.space_name = spaceName;
        existing.meeting_uri = meetingUri;
        existing.meeting_code = meetingCode;
        existing.updated_at = updatedAt;
      }
      return { success: true, meta: {} };
    }
    if (sql.includes("SET status = 'active'")) {
      const [spaceName, meetingUri, meetingCode, calendarEventId, calendarHtmlLink, updatedAt, id] =
        args as [string, string, string, string, string | null, string, string];
      const existing = meetings.get(id);
      if (existing) {
        existing.status = "active";
        existing.space_name = spaceName;
        existing.meeting_uri = meetingUri;
        existing.meeting_code = meetingCode;
        existing.calendar_event_id = calendarEventId;
        existing.calendar_html_link = calendarHtmlLink;
        existing.last_error = null;
        existing.updated_at = updatedAt;
      }
      return { success: true, meta: {} };
    }
    if (sql.includes("SET status = 'failed'")) {
      const [lastError, spaceName, meetingUri, meetingCode, updatedAt, id] = args as [
        string,
        string | null,
        string | null,
        string | null,
        string,
        string,
      ];
      const existing = meetings.get(id);
      if (existing) {
        existing.status = "failed";
        existing.last_error = lastError;
        existing.space_name = spaceName ?? existing.space_name;
        existing.meeting_uri = meetingUri ?? existing.meeting_uri;
        existing.meeting_code = meetingCode ?? existing.meeting_code;
        existing.updated_at = updatedAt;
      }
      return { success: true, meta: {} };
    }
    if (sql.includes("SET last_error = ?")) {
      const [lastError, updatedAt, id] = args as [string | null, string, string];
      const existing = meetings.get(id);
      if (existing) {
        existing.last_error = lastError;
        existing.updated_at = updatedAt;
      }
      return { success: true, meta: {} };
    }
    if (sql.includes("INSERT INTO drive_share_checks")) {
      const [emailNormalized, status, httpStatus, apiStatus, source, checkedAt] = args as [
        string,
        "ok" | "unshareable",
        number | null,
        string | null,
        "probe" | "share",
        string,
      ];
      shareChecks.set(emailNormalized, {
        email_normalized: emailNormalized,
        status,
        http_status: httpStatus,
        api_status: apiStatus,
        source,
        checked_at: checkedAt,
      });
      return { success: true, meta: {} };
    }
    if (sql.includes("INSERT INTO drive_probe_file")) {
      probeFileId = String(args[0]);
      return { success: true, meta: {} };
    }
    throw new Error(`未対応の SQL: ${sql}`);
  }

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        __op: () => ({ sql, args }),
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM google_connection WHERE id = ?")) {
            return connection as T | null;
          }
          if (sql.includes(`FROM "user" WHERE id = ?`)) {
            return { oidc_subject: `accounts-${String(args[0])}` } as T;
          }
          if (sql.includes("FROM drive_probe_file WHERE id = 1")) {
            return (probeFileId ? { file_id: probeFileId } : null) as T | null;
          }
          throw new Error(`未対応の first(): ${sql}`);
        },
        async all<T>() {
          if (sql.includes("FROM drive_share_checks")) {
            const results = args
              .map((email) => shareChecks.get(String(email)))
              .filter((row): row is NonNullable<typeof row> => Boolean(row));
            return { results: results as T[] };
          }
          throw new Error(`未対応の all(): ${sql}`);
        },
        async run() {
          return executeOp({ sql, args });
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ __op: () => PlannedOp }>) {
      return statements.map((stmt) => executeOp(stmt.__op()));
    },
  };

  return {
    db: db as unknown as D1Database,
    meetings,
    sources,
    invitees,
  };
}

async function createConnectedEnv(options: {
  connected?: boolean;
  members?: MeetDirectoryMember[];
  registeredEmails?: string[];
  shareChecks?: Array<{
    email_normalized: string;
    status: "ok" | "unshareable";
    http_status: number | null;
    api_status: string | null;
    source: "probe" | "share";
    checked_at: string;
  }>;
}) {
  let connection: GoogleConnectionRow | null = null;
  if (options.connected !== false) {
    const encrypted = await encryptRefreshToken(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
      GOOGLE_CONNECTION_AAD,
      "1//0g-test-refresh-token",
    );
    connection = {
      id: 1,
      email: HOST_EMAIL,
      google_user_id: "110999888777",
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
  }

  const dbFixture = createFakeMeetingsDb(connection, { shareChecks: options.shareChecks });
  const queueSend = vi.fn().mockResolvedValue(undefined);
  const listChapterMembers = vi.fn().mockResolvedValue({
    ok: true,
    members: options.members ?? [],
  });
  const listRegisteredEmails = vi.fn().mockResolvedValue({
    ok: true,
    emails: options.registeredEmails ?? ["guest@example.com"],
  });

  const env = {
    DB: dbFixture.db,
    APP_URL: "https://meet.gdgs.jp",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    GOOGLE_HOST_EMAIL: HOST_EMAIL,
    ACCOUNTS_DIRECTORY: { listChapterMembers, listRegisteredEmails },
    MEET_JOBS: { send: queueSend },
  } as unknown as Env;

  return { env, dbFixture, queueSend, listChapterMembers };
}

const ACTOR: MeetActor = {
  user: {
    id: "u-creator",
    email: "creator@example.com",
    name: "Creator Name",
    image: null,
    isAdmin: false,
  },
  chapters: [{ chapterId: 1, chapterSlug: "gdg-tokyo", role: "member" }],
};

function buildValidForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    title: "GDG 定例ミーティング",
    description: "今月のイベント準備について話します。",
    date: "2026-12-01",
    startTime: "19:00",
    endTime: "20:00",
    timeZone: "Asia/Tokyo",
    hostChapterId: "1",
    includeHostOrganizers: "true",
    accessType: "RESTRICTED",
    autoTranscription: "true",
    autoSmartNotes: "true",
    autoRecording: "false",
    additionalChapters: "[]",
    cohostEmails: "",
    participantEmails: "guest@example.com",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) {
    form.set(k, v);
  }
  return form;
}

beforeEach(() => {
  resetGoogleAccessTokenCache();
});

afterEach(() => {
  resetGoogleAccessTokenCache();
});

describe("createMeeting", () => {
  it("方式 B でスペース作成 → Calendar 予定作成（conferenceData / guestsCanSeeOtherGuests=true / extendedProperties）→ MEET_JOBS 投入を行う", async () => {
    const { env, dbFixture, queueSend, listChapterMembers } = await createConnectedEnv({
      members: [
        {
          userId: "u-org",
          name: "Tokyo Organizer",
          email: "org@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
        {
          userId: "u-host",
          name: "Shared Host",
          email: HOST_EMAIL,
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
      ],
    });

    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.mock-token", expires_in: 3600 });
      }
      const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      calls.push({ url, method, body: parsedBody });

      if (url === "https://meet.googleapis.com/v2/spaces" && method === "POST") {
        return Response.json({
          name: "spaces/space-123",
          meetingUri: "https://meet.google.com/abc-defg-hij",
          meetingCode: "abc-defg-hij",
          config: { accessType: "RESTRICTED", moderation: "ON" },
        });
      }
      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        return Response.json({
          id: "cal-evt-456",
          htmlLink: "https://calendar.google.com/calendar/event?eid=456",
        });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    let idSeq = 0;
    const result = await createMeeting(env, ACTOR, buildValidForm(), {
      fetchFn: fetchMock,
      now: () => new Date("2026-11-19T05:00:00.000Z"),
      generateId: () => `id-${++idSeq}`,
    });

    expect(result).toEqual({ ok: true, meetingId: "id-1" });
    expect(listChapterMembers).toHaveBeenCalledWith({
      actor: { ...ACTOR, user: { ...ACTOR.user, id: "accounts-u-creator" } },
      chapterIds: [1],
      roles: ["organizer"],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: "https://meet.googleapis.com/v2/spaces",
      method: "POST",
      body: {
        config: {
          accessType: "RESTRICTED",
          moderation: "ON",
          artifactConfig: {
            transcriptionConfig: { autoTranscriptionGeneration: "ON" },
            smartNotesConfig: { autoSmartNotesGeneration: "ON" },
            recordingConfig: { autoRecordingGeneration: "OFF" },
          },
        },
      },
    });

    const calendarUrl = new URL(calls[1].url);
    expect(calendarUrl.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(calendarUrl.searchParams.get("sendUpdates")).toBe("all");
    expect(calls[1].body).toMatchObject({
      summary: "GDG 定例ミーティング",
      description:
        "今月のイベント準備について話します。\n\n管理ページ: https://meet.gdgs.jp/meetings/id-1",
      start: { dateTime: "2026-12-01T10:00:00.000Z", timeZone: "Asia/Tokyo" },
      end: { dateTime: "2026-12-01T11:00:00.000Z", timeZone: "Asia/Tokyo" },
      guestsCanSeeOtherGuests: true,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [
          {
            entryPointType: "video",
            uri: "https://meet.google.com/abc-defg-hij",
            label: "meet.google.com/abc-defg-hij",
          },
        ],
      },
      extendedProperties: {
        private: { gdgsMeetId: "id-1" },
      },
    });
    const attendees = (calls[1].body as { attendees: Array<{ email: string }> }).attendees;
    expect(attendees.map((a) => a.email).sort()).toEqual([
      "creator@example.com",
      "guest@example.com",
      "org@example.com",
    ]);
    expect(attendees.some((a) => a.email === HOST_EMAIL)).toBe(false);

    const saved = dbFixture.meetings.get("id-1");
    expect(saved).toMatchObject({
      status: "active",
      auto_transcription: 1,
      auto_smart_notes: 1,
      auto_recording: 0,
      space_name: "spaces/space-123",
      meeting_uri: "https://meet.google.com/abc-defg-hij",
      meeting_code: "abc-defg-hij",
      calendar_event_id: "cal-evt-456",
      calendar_html_link: "https://calendar.google.com/calendar/event?eid=456",
      last_error: null,
    });
    expect(dbFixture.invitees).toHaveLength(3);
    expect(queueSend).toHaveBeenCalledWith({ type: "sync_members", meetingId: "id-1" });
  });

  it("自動記録設定（文字起こしオフ・録画オン等）のカスタマイズが spaces.create と D1 へ反映される", async () => {
    const { env, dbFixture } = await createConnectedEnv({ members: [] });
    const spaceBodies: unknown[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.mock-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces" && init?.method === "POST") {
        spaceBodies.push(JSON.parse(String(init.body)));
        return Response.json({
          name: "spaces/custom-1",
          meetingUri: "https://meet.google.com/custom-uri",
          meetingCode: "custom-uri",
        });
      }
      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
        return Response.json({ id: "cal-evt-custom" });
      }
      throw new Error(`想定外の fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await createMeeting(
      env,
      ACTOR,
      buildValidForm({
        includeHostOrganizers: "false",
        autoTranscription: "false",
        autoSmartNotes: "true",
        autoRecording: "true",
      }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T05:00:00.000Z"),
        generateId: () => "mtg-custom",
      },
    );

    expect(result).toEqual({ ok: true, meetingId: "mtg-custom" });
    expect(spaceBodies).toEqual([
      {
        config: {
          accessType: "RESTRICTED",
          moderation: "ON",
          artifactConfig: {
            transcriptionConfig: { autoTranscriptionGeneration: "OFF" },
            smartNotesConfig: { autoSmartNotesGeneration: "ON" },
            recordingConfig: { autoRecordingGeneration: "ON" },
          },
        },
      },
    ]);
    expect(dbFixture.meetings.get("mtg-custom")).toMatchObject({
      auto_transcription: 0,
      auto_smart_notes: 1,
      auto_recording: 1,
    });
  });

  it("spaces.create 成功後に events.insert が失敗した場合は status='failed'・last_error・space_name を D1 に残す", async () => {
    const { env, dbFixture, queueSend } = await createConnectedEnv({ members: [] });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.mock-token", expires_in: 3600 });
      }
      if (url === "https://meet.googleapis.com/v2/spaces") {
        return Response.json({
          name: "spaces/orphan-999",
          meetingUri: "https://meet.google.com/xxx-yyyy-zzz",
          meetingCode: "xxx-yyyy-zzz",
        });
      }
      return Response.json(
        { error: { status: "INTERNAL", message: "Calendar backend unavailable" } },
        { status: 500 },
      );
    }) as unknown as typeof fetch;

    const result = await createMeeting(
      env,
      ACTOR,
      buildValidForm({ includeHostOrganizers: "false" }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T05:00:00.000Z"),
        generateId: () => "mtg-fail",
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.meetingId).toBe("mtg-fail");

    const saved = dbFixture.meetings.get("mtg-fail");
    expect(saved).toMatchObject({
      status: "failed",
      space_name: "spaces/orphan-999",
      meeting_uri: "https://meet.google.com/xxx-yyyy-zzz",
      meeting_code: "xxx-yyyy-zzz",
    });
    expect(saved?.last_error).toContain("500");
    expect(saved?.last_error).not.toContain("ya29.mock-token");
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("Google 未接続時は Google API も D1 保存も行わずエラーを返す", async () => {
    const { env, dbFixture, queueSend } = await createConnectedEnv({ connected: false });
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const result = await createMeeting(env, ACTOR, buildValidForm(), { fetchFn: fetchMock });

    expect(result.ok).toBe(false);
    expect(dbFixture.meetings.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("@googlegroups.com や不正時刻はフォーム検証で弾く", async () => {
    const { env, dbFixture } = await createConnectedEnv({ members: [] });
    const result = await createMeeting(
      env,
      ACTOR,
      buildValidForm({
        startTime: "20:00",
        endTime: "19:00",
        cohostEmails: "organizers@googlegroups.com",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.endTime).toBeTruthy();
    expect(result.fieldErrors?.cohostEmails).toContain("googlegroups.com");
    expect(dbFixture.meetings.size).toBe(0);
  });

  it("Drive で共有不可（400 invalidSharingRequest）と判定された招待者がいる場合は D1 や Meet/Calendar API 書き込み前に拒否する", async () => {
    const { env, dbFixture, queueSend } = await createConnectedEnv({
      members: [],
      registeredEmails: [],
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.probe-token", expires_in: 3600 });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && method === "POST") {
        return Response.json({ id: "probe-file-1" });
      }
      if (url.includes("/drive/v3/files/probe-file-1/permissions?") && method === "POST") {
        return Response.json(
          {
            error: {
              code: 400,
              message: "Invalid sharing request",
              errors: [{ reason: "invalidSharingRequest" }],
            },
          },
          { status: 400 },
        );
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await createMeeting(
      env,
      ACTOR,
      buildValidForm({
        includeHostOrganizers: "false",
        participantEmails: "Missing.User@example.com",
      }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-20T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      ok: false,
      formError:
        "Google アカウントとして共有できないメールアドレスが含まれています: Missing.User@example.com。アドレスを確認するか、招待先から外してください。",
    });
    expect(dbFixture.meetings.size).toBe(0);
    expect(queueSend).not.toHaveBeenCalled();
  });
});

describe("previewMeetingInvitees", () => {
  it("人数内訳のみを返し、チャプター由来メンバーのメールアドレスを応答に含めない", async () => {
    const { env } = await createConnectedEnv({
      members: [
        {
          userId: "u-secret",
          name: "Secret Organizer",
          email: "secret-chapter-member@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
      ],
    });

    const result = await previewMeetingInvitees(env, ACTOR, buildValidForm());
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: true,
      counts: {
        creatorCount: 1,
        hostChapterCount: 1,
        otherChaptersCount: 0,
        emailCount: 1,
        totalCount: 3,
        cohostCount: 2,
        participantCount: 1,
        exceedsMaxInvitees: false,
        exceedsMaxCohosts: false,
      },
    });
    expect(serialized).not.toContain("secret-chapter-member@example.com");
    expect(serialized).not.toContain("Secret Organizer");
  });
});
