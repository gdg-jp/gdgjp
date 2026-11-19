import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import {
  canEditMeeting,
  canViewMeeting,
  requireMeetingEditAccess,
  requireMeetingViewAccess,
  toPublicInviteeList,
} from "./access.server";
import type { MeetingInviteeRecord, MeetingRecord } from "./meeting";

const SAMPLE_MEETING: MeetingRecord = {
  id: "mtg-1",
  hostChapterId: 1,
  title: "定例ミーティング",
  description: "",
  startAt: "2026-12-01T10:00:00.000Z",
  endAt: "2026-12-01T11:00:00.000Z",
  timeZone: "Asia/Tokyo",
  accessType: "RESTRICTED",
  autoTranscription: true,
  autoSmartNotes: true,
  autoRecording: false,
  spaceName: "spaces/abc",
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

const SAMPLE_INVITEES: MeetingInviteeRecord[] = [
  {
    meetingId: "mtg-1",
    emailNormalized: "creator@example.com",
    email: "creator@example.com",
    displayName: "Creator User",
    userId: "u-creator",
    role: "cohost",
    sourceKinds: ["creator", "host_chapter_organizers"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "chapterorg@gmail.com",
    email: "chapter.org@gmail.com",
    displayName: "Chapter Organizer",
    userId: "u-org",
    role: "cohost",
    sourceKinds: ["host_chapter_organizers"],
  },
  {
    meetingId: "mtg-1",
    emailNormalized: "otherchapter@example.com",
    email: "other.chapter@example.com",
    displayName: "Other Chapter Member",
    userId: "u-other",
    role: "participant",
    sourceKinds: ["chapter_all"],
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

function createFakeDb(meeting: MeetingRecord | null, invitees: MeetingInviteeRecord[]) {
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T>(): Promise<T | null> {
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
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

describe("canViewMeeting / requireMeetingViewAccess", () => {
  it("招待者・作成者・管理者以外のアクセスは 404 で拒否する", async () => {
    const outsider: AuthUser = {
      id: "u-outsider",
      email: "outsider@example.com",
      name: "Outsider",
      image: null,
      isAdmin: false,
    };
    const env = { DB: createFakeDb(SAMPLE_MEETING, SAMPLE_INVITEES) } as unknown as Env;

    let caught: unknown;
    try {
      await requireMeetingViewAccess(
        env,
        new Request("https://meet.gdgs.jp/meetings/mtg-1"),
        "mtg-1",
        {
          requireUserFn: async () => outsider,
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(404);
  });

  it("Gmail のドット違いでも正規化メール一致で招待者として閲覧できる（チャプター未所属可）", async () => {
    const cohostWithDifferentDots: AuthUser = {
      id: "u-no-chapter",
      email: "ChapterOrg@gmail.com",
      name: "Chapter Organizer",
      image: null,
      isAdmin: false,
    };
    const env = { DB: createFakeDb(SAMPLE_MEETING, SAMPLE_INVITEES) } as unknown as Env;

    const access = await requireMeetingViewAccess(
      env,
      new Request("https://meet.gdgs.jp/meetings/mtg-1"),
      "mtg-1",
      { requireUserFn: async () => cohostWithDifferentDots },
    );

    expect(access.meeting.id).toBe("mtg-1");
  });

  it("管理者は招待者に含まれていなくても閲覧できる", () => {
    const admin: AuthUser = {
      id: "u-admin",
      email: "admin@example.com",
      name: "Admin",
      image: null,
      isAdmin: true,
    };
    expect(canViewMeeting(admin, SAMPLE_MEETING, SAMPLE_INVITEES)).toBe(true);
  });
});

describe("toPublicInviteeList", () => {
  it("チャプター由来・個別メール・作成者のいずれについても名前とメールアドレスを返す", () => {
    const result = toPublicInviteeList(SAMPLE_INVITEES);

    expect(result).toEqual([
      {
        displayName: "Creator User",
        email: "creator@example.com",
        role: "cohost",
        isCreator: true,
        isChapterDerived: true,
      },
      {
        displayName: "Chapter Organizer",
        email: "chapter.org@gmail.com",
        role: "cohost",
        isCreator: false,
        isChapterDerived: true,
      },
      {
        displayName: "Other Chapter Member",
        email: "other.chapter@example.com",
        role: "participant",
        isCreator: false,
        isChapterDerived: true,
      },
      {
        displayName: null,
        email: "guest@example.com",
        role: "participant",
        isCreator: false,
        isChapterDerived: false,
      },
    ]);
  });
});

describe("canEditMeeting / requireMeetingEditAccess", () => {
  it("cohost でない一般招待者（participant）は編集・再同期・取り消しを実行できない（403）", async () => {
    const participant: AuthUser = {
      id: "u-guest",
      email: "guest@example.com",
      name: "Guest",
      image: null,
      isAdmin: false,
    };
    expect(canEditMeeting(participant, SAMPLE_MEETING, SAMPLE_INVITEES)).toBe(false);

    const env = { DB: createFakeDb(SAMPLE_MEETING, SAMPLE_INVITEES) } as unknown as Env;
    let caught: unknown;
    try {
      await requireMeetingEditAccess(
        env,
        new Request("https://meet.gdgs.jp/meetings/mtg-1/edit"),
        "mtg-1",
        { requireUserFn: async () => participant },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
  });

  it("会議に無関係な第三者は 404 で拒否する", async () => {
    const outsider: AuthUser = {
      id: "u-outsider",
      email: "outsider@example.com",
      name: "Outsider",
      image: null,
      isAdmin: false,
    };
    const env = { DB: createFakeDb(SAMPLE_MEETING, SAMPLE_INVITEES) } as unknown as Env;

    let caught: unknown;
    try {
      await requireMeetingEditAccess(
        env,
        new Request("https://meet.gdgs.jp/meetings/mtg-1/edit"),
        "mtg-1",
        { requireUserFn: async () => outsider },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(404);
  });

  it("GDG Accounts 管理者（isAdmin: true）は招待されていなくても編集・取り消しできる", async () => {
    const admin: AuthUser = {
      id: "u-admin",
      email: "admin@example.com",
      name: "Admin",
      image: null,
      isAdmin: true,
    };
    expect(canEditMeeting(admin, SAMPLE_MEETING, SAMPLE_INVITEES)).toBe(true);

    const env = { DB: createFakeDb(SAMPLE_MEETING, SAMPLE_INVITEES) } as unknown as Env;
    const access = await requireMeetingEditAccess(
      env,
      new Request("https://meet.gdgs.jp/meetings/mtg-1/edit"),
      "mtg-1",
      { requireUserFn: async () => admin },
    );
    expect(access.meeting.id).toBe("mtg-1");
  });

  it("チャプター未所属ユーザーでも正規化メールが cohost の招待者と一致すれば編集・取り消しできる", async () => {
    const noChapterCohost: AuthUser = {
      id: "u-no-chapter",
      email: "ChapterOrg@gmail.com",
      name: "Chapter Organizer",
      image: null,
      isAdmin: false,
    };
    expect(canEditMeeting(noChapterCohost, SAMPLE_MEETING, SAMPLE_INVITEES)).toBe(true);

    const env = { DB: createFakeDb(SAMPLE_MEETING, SAMPLE_INVITEES) } as unknown as Env;
    const access = await requireMeetingEditAccess(
      env,
      new Request("https://meet.gdgs.jp/meetings/mtg-1/edit"),
      "mtg-1",
      { requireUserFn: async () => noChapterCohost },
    );
    expect(access.user.id).toBe("u-no-chapter");
  });

  it("status === 'canceled' や 'failed' の会議は編集・再同期・再取り消しできない（409）", async () => {
    const cohost: AuthUser = {
      id: "u-creator",
      email: "creator@example.com",
      name: "Creator User",
      image: null,
      isAdmin: false,
    };
    const canceledMeeting: MeetingRecord = {
      ...SAMPLE_MEETING,
      status: "canceled",
      canceledAt: "2026-11-19T12:00:00.000Z",
    };
    const failedMeeting: MeetingRecord = { ...SAMPLE_MEETING, status: "failed" };

    expect(canEditMeeting(cohost, canceledMeeting, SAMPLE_INVITEES)).toBe(false);
    expect(canEditMeeting(cohost, failedMeeting, SAMPLE_INVITEES)).toBe(false);

    const env = { DB: createFakeDb(canceledMeeting, SAMPLE_INVITEES) } as unknown as Env;
    let caught: unknown;
    try {
      await requireMeetingEditAccess(
        env,
        new Request("https://meet.gdgs.jp/meetings/mtg-1/edit"),
        "mtg-1",
        { requireUserFn: async () => cohost },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(409);
  });
});
