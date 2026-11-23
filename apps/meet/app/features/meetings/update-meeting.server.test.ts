import type { MeetActor, MeetDirectoryMember } from "@gdgjp/gdg-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConnectionRow } from "~/features/google/connection.server";
import { GOOGLE_CONNECTION_AAD, encryptRefreshToken } from "~/features/google/encryption.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { MeetingInviteSourceRecord, MeetingInviteeRecord, MeetingRecord } from "./meeting";
import {
  resyncMeetingInvitees,
  summarizeInviteeDiff,
  updateMeeting,
} from "./update-meeting.server";

const TEST_KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const HOST_EMAIL = "community-support@gdgoc.jp";

const ACTIVE_MEETING: MeetingRecord = {
  id: "mtg-1",
  hostChapterId: 1,
  title: "変更前タイトル",
  description: "変更前説明",
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "RESTRICTED",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/space-1",
  meetingUri: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
  calendarEventId: "evt-1",
  calendarHtmlLink: "https://calendar.google.com/event?eid=1",
  status: "active",
  lastError: null,
  createdByUserId: "u-creator",
  createdByEmail: "creator@example.com",
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  canceledAt: null,
};

const EXISTING_SOURCES: MeetingInviteSourceRecord[] = [
  {
    id: "src-1",
    meetingId: "mtg-1",
    kind: "host_chapter_organizers",
    chapterId: 1,
    email: null,
    role: "cohost",
    createdAt: "2026-11-19T00:00:00.000Z",
  },
  {
    id: "src-2",
    meetingId: "mtg-1",
    kind: "email",
    chapterId: null,
    email: "guest@example.com",
    role: "participant",
    createdAt: "2026-11-19T00:00:00.000Z",
  },
];

const EXISTING_INVITEES: MeetingInviteeRecord[] = [
  {
    meetingId: "mtg-1",
    emailNormalized: "creator@example.com",
    email: "creator@example.com",
    displayName: "Creator Name",
    userId: "u-creator",
    role: "cohost",
    sourceKinds: ["creator"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "org@example.com",
    email: "org@example.com",
    displayName: "Tokyo Organizer",
    userId: "u-org",
    role: "cohost",
    sourceKinds: ["host_chapter_organizers"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "guest@example.com",
    email: "guest@example.com",
    displayName: null,
    userId: null,
    role: "participant",
    sourceKinds: ["email"],
  },
];

const ACTOR: MeetActor = {
  user: {
    id: "u-creator",
    email: "creator@example.com",
    name: "Creator Name",
    image: null,
    isAdmin: false,
  },
  chapters: [{ chapterId: 1, chapterSlug: "gdg-tokyo", role: "organizer" }],
};

function createFakeEditDb(
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
  let updatedMeeting: Record<string, unknown> | null = null;
  let storedSources: Array<Record<string, unknown>> = [];
  let storedInvitees: Array<Record<string, unknown>> = [];
  const batchHistory: string[][] = [];
  const shareChecks = new Map(
    (options.shareChecks ?? []).map((row) => [row.email_normalized, row]),
  );
  let probeFileId: string | null = null;

  type PlannedOp = { sql: string; args: unknown[] };

  function executeOp(op: PlannedOp) {
    const { sql, args } = op;
    if (sql.includes("DELETE FROM meeting_invite_sources")) {
      storedSources = [];
      return { success: true, meta: {} };
    }
    if (sql.includes("DELETE FROM meeting_invitees")) {
      storedInvitees = [];
      return { success: true, meta: {} };
    }
    if (sql.includes("INSERT INTO meeting_invite_sources")) {
      const [id, meetingId, kind, chapterId, email, role, createdAt] = args;
      storedSources.push({ id, meetingId, kind, chapterId, email, role, createdAt });
      return { success: true, meta: {} };
    }
    if (sql.includes("INSERT INTO meeting_invitees")) {
      const [meetingId, emailNormalized, email, displayName, userId, role, sourceKinds] = args;
      storedInvitees.push({
        meetingId,
        emailNormalized,
        email,
        displayName,
        userId,
        role,
        sourceKinds,
      });
      return { success: true, meta: {} };
    }
    if (sql.includes("SET title = ?, description = ?")) {
      const [
        title,
        description,
        startAt,
        endAt,
        timeZone,
        accessType,
        autoTranscription,
        autoSmartNotes,
        autoRecording,
        htmlLink,
        updatedAt,
        id,
      ] = args;
      updatedMeeting = {
        id,
        title,
        description,
        startAt,
        endAt,
        timeZone,
        accessType,
        autoTranscription,
        autoSmartNotes,
        autoRecording,
        htmlLink,
        updatedAt,
      };
      return { success: true, meta: {} };
    }
    if (sql.includes("UPDATE meetings SET updated_at = ?")) {
      updatedMeeting = { ...(updatedMeeting ?? {}), updatedAt: args[0], id: args[1] };
      return { success: true, meta: {} };
    }
    if (sql.includes("SET last_error = ?")) {
      updatedMeeting = { ...(updatedMeeting ?? {}), lastError: args[0], updatedAt: args[1] };
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
      const ops = statements.map((s) => s.__op());
      batchHistory.push(ops.map((op) => op.sql.trim().split("\n")[0]));
      return ops.map((op) => executeOp(op));
    },
  };

  return {
    db: db as unknown as D1Database,
    getUpdatedMeeting: () => updatedMeeting,
    getStoredSources: () => storedSources,
    getStoredInvitees: () => storedInvitees,
    batchHistory,
  };
}

async function createEnvFixture(options: {
  connected?: boolean;
  members?: MeetDirectoryMember[];
  registeredEmails?: string[];
}) {
  let connection: GoogleConnectionRow | null = null;
  if (options.connected !== false) {
    const encrypted = await encryptRefreshToken(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: TEST_KEY },
      GOOGLE_CONNECTION_AAD,
      "1//0g-edit-refresh-token",
    );
    connection = {
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
  }

  const dbFixture = createFakeEditDb(connection);
  const queueSend = vi.fn().mockResolvedValue(undefined);
  const listChapterMembers = vi.fn().mockResolvedValue({
    ok: true,
    members: options.members ?? [],
  });
  const listRegisteredEmails = vi.fn().mockResolvedValue({
    ok: true,
    emails: options.registeredEmails ?? ["new-cohost@example.com"],
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

function buildEditForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values: Record<string, string> = {
    title: "変更前タイトル",
    description: "変更前説明",
    date: "2026-12-01",
    startTime: "19:00",
    endTime: "20:00",
    timeZone: "Asia/Tokyo",
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

describe("updateMeeting", () => {
  it("タイトル・時刻のみ変更時は spaces.patch や RPC・sync_members を呼ばず Calendar patchEvent（ゲスト可視性 3 項目維持）のみ実行する", async () => {
    const { env, dbFixture, queueSend, listChapterMembers } = await createEnvFixture({});
    const reshareMock = vi.fn().mockResolvedValue(undefined);
    const calls: Array<{ url: string; method: string; body: unknown }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.edit-token", expires_in: 3600 });
      }
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "PATCH") {
        return Response.json({ id: "evt-1", htmlLink: "https://calendar.google.com/event?eid=1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await updateMeeting(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      buildEditForm({ title: "新しいタイトル", startTime: "19:30", endTime: "20:30" }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T06:00:00.000Z"),
        enqueueArtifactReshareFn: reshareMock,
      },
    );

    expect(result).toEqual({
      ok: true,
      meetingId: "mtg-1",
      inviteesChanged: false,
      cohostAdded: false,
      inviteeRemoved: false,
    });
    expect(listChapterMembers).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
    expect(reshareMock).not.toHaveBeenCalled();
    expect(dbFixture.batchHistory).toHaveLength(0);

    expect(calls).toHaveLength(1);
    const calUrl = new URL(calls[0].url);
    expect(calUrl.searchParams.get("sendUpdates")).toBe("all");
    expect(calls[0].body).toEqual({
      summary: "新しいタイトル",
      description: "変更前説明\n\n管理ページ: https://meet.gdgs.jp/meetings/mtg-1",
      start: { dateTime: "2026-12-01T10:30:00.000Z", timeZone: "Asia/Tokyo" },
      end: { dateTime: "2026-12-01T11:30:00.000Z", timeZone: "Asia/Tokyo" },
      guestsCanSeeOtherGuests: true,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
    });
    expect(dbFixture.getUpdatedMeeting()).toMatchObject({
      title: "新しいタイトル",
      startAt: "2026-12-01T10:30:00.000Z",
      endAt: "2026-12-01T11:30:00.000Z",
    });
  });

  it("accessType 変更時は spaces.patch(config.accessType) を呼び、招待者変更時は RPC・D1 batch・attendees・sync_members・再共有フックを実行する（Drive 権限削除は呼ばない）", async () => {
    const { env, dbFixture, queueSend, listChapterMembers } = await createEnvFixture({
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
      ],
    });
    const reshareMock = vi.fn().mockResolvedValue(undefined);
    const calls: Array<{ url: string; method: string; body: unknown }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.edit-token", expires_in: 3600 });
      }
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.startsWith("https://meet.googleapis.com/v2/spaces/space-1") && method === "PATCH") {
        return Response.json({
          name: "spaces/space-1",
          meetingUri: ACTIVE_MEETING.meetingUri,
          meetingCode: ACTIVE_MEETING.meetingCode,
          config: { accessType: "TRUSTED", moderation: "ON" },
        });
      }
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "PATCH") {
        return Response.json({ id: "evt-1", htmlLink: "https://calendar.google.com/event?eid=1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    let idSeq = 0;
    const result = await updateMeeting(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      buildEditForm({
        accessType: "TRUSTED",
        cohostEmails: "new-cohost@example.com",
        participantEmails: "",
      }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T06:30:00.000Z"),
        generateId: () => `src-new-${++idSeq}`,
        enqueueArtifactReshareFn: reshareMock,
      },
    );

    expect(result).toEqual({
      ok: true,
      meetingId: "mtg-1",
      inviteesChanged: true,
      cohostAdded: true,
      inviteeRemoved: true,
    });
    expect(listChapterMembers).toHaveBeenCalledWith({
      actor: { ...ACTOR, user: { ...ACTOR.user, id: "accounts-u-creator" } },
      chapterIds: [1],
      roles: ["organizer"],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: "https://meet.googleapis.com/v2/spaces/space-1?updateMask=config.accessType",
      method: "PATCH",
      body: { config: { accessType: "TRUSTED" } },
    });
    expect(calls.some((c) => c.url.includes("googleapis.com/drive"))).toBe(false);

    const calBody = calls[1].body as {
      attendees: Array<{ email: string }>;
      guestsCanSeeOtherGuests: boolean;
      guestsCanInviteOthers: boolean;
      guestsCanModify: boolean;
    };
    expect(calBody.guestsCanSeeOtherGuests).toBe(true);
    expect(calBody.guestsCanInviteOthers).toBe(false);
    expect(calBody.guestsCanModify).toBe(false);
    expect(calBody.attendees.map((a) => a.email).sort()).toEqual([
      "creator@example.com",
      "new-cohost@example.com",
      "org@example.com",
    ]);
    expect(calBody.attendees.some((a) => a.email === "guest@example.com")).toBe(false);

    expect(dbFixture.batchHistory).toHaveLength(1);
    expect(dbFixture.getStoredInvitees().map((i) => i.emailNormalized)).not.toContain(
      "guest@example.com",
    );
    expect(queueSend).toHaveBeenCalledWith({ type: "sync_members", meetingId: "mtg-1" });
    expect(reshareMock).toHaveBeenCalledWith(env, "mtg-1");
  });

  it("canceled 会議の編集は 409 で拒否し Google API を呼ばない", async () => {
    const { env, queueSend } = await createEnvFixture({});
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const result = await updateMeeting(
      env,
      ACTOR,
      { ...ACTIVE_MEETING, status: "canceled" },
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      buildEditForm({ title: "更新不可" }),
      { fetchFn: fetchMock },
    );

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("新規追加された招待者が Drive 共有不可（400 invalidSharingRequest）の場合は D1 や Calendar/Meet API を変更せず拒否する", async () => {
    const { env, dbFixture, queueSend } = await createEnvFixture({
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
      ],
      registeredEmails: [],
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.edit-probe", expires_in: 3600 });
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

    const result = await updateMeeting(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      buildEditForm({
        participantEmails: "guest@example.com\nBad.User@example.com",
      }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-20T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      ok: false,
      formError:
        "Google アカウントとして共有できないメールアドレスが含まれています: Bad.User@example.com。アドレスを確認するか、招待先から外してください。",
    });
    expect(dbFixture.batchHistory).toHaveLength(0);
    expect(dbFixture.getUpdatedMeeting()).toBeNull();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("自動記録設定のみ変更時は変更項目の updateMask だけで spaces.patch を呼び、D1 も更新する", async () => {
    const { env, dbFixture, queueSend } = await createEnvFixture({});
    const reshareMock = vi.fn().mockResolvedValue(undefined);
    const calls: Array<{ url: string; method: string; body: unknown }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.edit-token", expires_in: 3600 });
      }
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.startsWith("https://meet.googleapis.com/v2/spaces/space-1") && method === "PATCH") {
        return Response.json({ name: "spaces/space-1" });
      }
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "PATCH") {
        return Response.json({ id: "evt-1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await updateMeeting(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      buildEditForm({
        autoTranscription: "false",
        autoSmartNotes: "true",
        autoRecording: "true",
      }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T06:45:00.000Z"),
        enqueueArtifactReshareFn: reshareMock,
      },
    );

    expect(result).toEqual({
      ok: true,
      meetingId: "mtg-1",
      inviteesChanged: false,
      cohostAdded: false,
      inviteeRemoved: false,
    });
    expect(queueSend).not.toHaveBeenCalled();
    expect(reshareMock).not.toHaveBeenCalled();
    expect(calls[0]).toEqual({
      url: "https://meet.googleapis.com/v2/spaces/space-1?updateMask=config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration%2Cconfig.artifactConfig.recordingConfig.autoRecordingGeneration",
      method: "PATCH",
      body: {
        config: {
          artifactConfig: {
            transcriptionConfig: { autoTranscriptionGeneration: "OFF" },
            recordingConfig: { autoRecordingGeneration: "ON" },
          },
        },
      },
    });
    expect(dbFixture.getUpdatedMeeting()).toMatchObject({
      autoTranscription: 0,
      autoSmartNotes: 1,
      autoRecording: 1,
    });
  });

  it("accessType と自動記録設定を同時に変更すると 1 回の spaces.patch にまとめて送信する", async () => {
    const { env, dbFixture } = await createEnvFixture({});
    const reshareMock = vi.fn().mockResolvedValue(undefined);
    const spacePatches: Array<{ url: string; body: unknown }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.edit-token", expires_in: 3600 });
      }
      if (url.startsWith("https://meet.googleapis.com/v2/spaces/space-1") && method === "PATCH") {
        spacePatches.push({ url, body: JSON.parse(String(init?.body)) });
        return Response.json({ name: "spaces/space-1" });
      }
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "PATCH") {
        return Response.json({ id: "evt-1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await updateMeeting(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      buildEditForm({
        accessType: "OPEN",
        autoTranscription: "true",
        autoSmartNotes: "false",
        autoRecording: "true",
      }),
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T06:50:00.000Z"),
        enqueueArtifactReshareFn: reshareMock,
      },
    );

    expect(result).toEqual({
      ok: true,
      meetingId: "mtg-1",
      inviteesChanged: false,
      cohostAdded: false,
      inviteeRemoved: false,
    });
    expect(spacePatches).toHaveLength(1);
    expect(spacePatches[0]).toEqual({
      url: "https://meet.googleapis.com/v2/spaces/space-1?updateMask=config.accessType%2Cconfig.artifactConfig.smartNotesConfig.autoSmartNotesGeneration%2Cconfig.artifactConfig.recordingConfig.autoRecordingGeneration",
      body: {
        config: {
          accessType: "OPEN",
          artifactConfig: {
            smartNotesConfig: { autoSmartNotesGeneration: "OFF" },
            recordingConfig: { autoRecordingGeneration: "ON" },
          },
        },
      },
    });
    expect(dbFixture.getUpdatedMeeting()).toMatchObject({
      accessType: "OPEN",
      autoTranscription: 1,
      autoSmartNotes: 0,
      autoRecording: 1,
    });
  });
});

describe("resyncMeetingInvitees", () => {
  it("チャプターメンバーに差分がある場合のみ D1・Calendar attendees・sync_members・再共有フックを更新する（Drive 削除なし）", async () => {
    const { env, dbFixture, queueSend, listChapterMembers } = await createEnvFixture({
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
          userId: "u-org-2",
          name: "Second Organizer",
          email: "org2@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
      ],
    });
    const reshareMock = vi.fn().mockResolvedValue(undefined);
    const calls: Array<{ url: string; method: string; body: unknown }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.resync-token", expires_in: 3600 });
      }
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && method === "PATCH") {
        return Response.json({ id: "evt-1" });
      }
      throw new Error(`想定外の fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const result = await resyncMeetingInvitees(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T07:00:00.000Z"),
        enqueueArtifactReshareFn: reshareMock,
      },
    );

    expect(result).toEqual({
      ok: true,
      changed: true,
      totalCount: 4,
      cohostAdded: true,
      inviteeRemoved: false,
    });
    expect(listChapterMembers).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).searchParams.get("sendUpdates")).toBe("all");
    expect(calls[0].body).toMatchObject({
      guestsCanSeeOtherGuests: true,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
    });
    expect(calls.some((c) => c.url.includes("googleapis.com/drive"))).toBe(false);
    expect(dbFixture.getStoredInvitees()).toHaveLength(4);
    expect(queueSend).toHaveBeenCalledWith({ type: "sync_members", meetingId: "mtg-1" });
    expect(reshareMock).toHaveBeenCalledWith(env, "mtg-1");
  });

  it("チャプターメンバーに差分がない場合は changed: false を返し Calendar 更新や Queue 投入を行わない", async () => {
    const { env, dbFixture, queueSend } = await createEnvFixture({
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
      ],
    });
    const reshareMock = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn() as unknown as typeof fetch;

    const result = await resyncMeetingInvitees(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      { fetchFn: fetchMock, enqueueArtifactReshareFn: reshareMock },
    );

    expect(result).toEqual({
      ok: true,
      changed: false,
      totalCount: 3,
      cohostAdded: false,
      inviteeRemoved: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbFixture.batchHistory).toHaveLength(0);
    expect(queueSend).not.toHaveBeenCalled();
    expect(reshareMock).not.toHaveBeenCalled();
  });

  it("生成ファイル再共有ジョブの投入に失敗しても再同期は成功として返し、last_error に記録する", async () => {
    const { env, dbFixture, queueSend } = await createEnvFixture({
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
          userId: "u-org-2",
          name: "Second Organizer",
          email: "org2@example.com",
          chapterId: 1,
          chapterSlug: "gdg-tokyo",
          chapterName: "GDG Tokyo",
          role: "organizer",
        },
      ],
    });
    const reshareMock = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "ya29.resync-token", expires_in: 3600 });
      }
      if (url.includes("/calendar/v3/calendars/primary/events/evt-1") && init?.method === "PATCH") {
        return Response.json({ id: "evt-1" });
      }
      throw new Error(`想定外の fetch: ${init?.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    const result = await resyncMeetingInvitees(
      env,
      ACTOR,
      ACTIVE_MEETING,
      EXISTING_SOURCES,
      EXISTING_INVITEES,
      {
        fetchFn: fetchMock,
        now: () => new Date("2026-11-19T07:00:00.000Z"),
        enqueueArtifactReshareFn: reshareMock,
      },
    );

    expect(result).toEqual({
      ok: true,
      changed: true,
      totalCount: 4,
      cohostAdded: true,
      inviteeRemoved: false,
    });
    expect(queueSend).toHaveBeenCalledWith({ type: "sync_members", meetingId: "mtg-1" });
    expect(reshareMock).toHaveBeenCalledWith(env, "mtg-1");
    expect(dbFixture.getUpdatedMeeting()?.lastError).toContain(
      "生成ファイルの再共有ジョブの投入に失敗しました: queue unavailable",
    );
  });
});

describe("summarizeInviteeDiff", () => {
  it("participant から cohost への昇格は cohostAdded: true を返す", () => {
    expect(
      summarizeInviteeDiff(
        [
          { emailNormalized: "a@example.com", role: "cohost" },
          { emailNormalized: "b@example.com", role: "participant" },
        ],
        [
          { emailNormalized: "a@example.com", role: "cohost" },
          { emailNormalized: "b@example.com", role: "cohost" },
        ],
      ),
    ).toEqual({ cohostAdded: true, inviteeRemoved: false });
  });

  it("participant のみの追加では cohostAdded: false かつ inviteeRemoved: false を返す", () => {
    expect(
      summarizeInviteeDiff(
        [{ emailNormalized: "a@example.com", role: "cohost" }],
        [
          { emailNormalized: "a@example.com", role: "cohost" },
          { emailNormalized: "b@example.com", role: "participant" },
        ],
      ),
    ).toEqual({ cohostAdded: false, inviteeRemoved: false });
  });

  it("既存招待者が外れた場合は inviteeRemoved: true を返す", () => {
    expect(
      summarizeInviteeDiff(
        [
          { emailNormalized: "a@example.com", role: "cohost" },
          { emailNormalized: "b@example.com", role: "participant" },
        ],
        [{ emailNormalized: "a@example.com", role: "cohost" }],
      ),
    ).toEqual({ cohostAdded: false, inviteeRemoved: true });
  });
});
