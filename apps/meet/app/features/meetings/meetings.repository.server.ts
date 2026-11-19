import type { ResolvedInvitee } from "./invitees";
import type {
  InviteSourceKind,
  InviteeRole,
  InviteeSourceKind,
  MeetingAccessType,
  MeetingInviteSourceRecord,
  MeetingInviteeRecord,
  MeetingListItem,
  MeetingRecord,
  MeetingStatus,
} from "./meeting";

type MeetingRow = {
  id: string;
  host_chapter_id: number;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  access_type: MeetingAccessType;
  space_name: string | null;
  meeting_uri: string | null;
  meeting_code: string | null;
  calendar_event_id: string | null;
  calendar_html_link: string | null;
  status: MeetingStatus;
  last_error: string | null;
  created_by_user_id: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
};

type MeetingListRow = MeetingRow & {
  my_role: InviteeRole | null;
};

type MeetingInviteSourceRow = {
  id: string;
  meeting_id: string;
  kind: InviteSourceKind;
  chapter_id: number | null;
  email: string | null;
  role: InviteeRole;
  created_at: string;
};

type MeetingInviteeRow = {
  meeting_id: string;
  email_normalized: string;
  email: string;
  display_name: string | null;
  user_id: string | null;
  role: InviteeRole;
  source_kinds: string;
};

function mapMeetingRow(row: MeetingRow): MeetingRecord {
  return {
    id: row.id,
    hostChapterId: Number(row.host_chapter_id),
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    timeZone: row.time_zone,
    accessType: row.access_type,
    spaceName: row.space_name,
    meetingUri: row.meeting_uri,
    meetingCode: row.meeting_code,
    calendarEventId: row.calendar_event_id,
    calendarHtmlLink: row.calendar_html_link,
    status: row.status,
    lastError: row.last_error,
    createdByUserId: row.created_by_user_id,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canceledAt: row.canceled_at,
  };
}

function parseSourceKinds(raw: string): InviteeSourceKind[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is InviteeSourceKind => typeof item === "string");
    }
  } catch {
    // 壊れた JSON があっても安全側（空配列）へ倒す。
  }
  return [];
}

function mapInviteeRow(row: MeetingInviteeRow): MeetingInviteeRecord {
  return {
    meetingId: row.meeting_id,
    emailNormalized: row.email_normalized,
    email: row.email,
    displayName: row.display_name,
    userId: row.user_id,
    role: row.role,
    sourceKinds: parseSourceKinds(row.source_kinds),
  };
}

function mapInviteSourceRow(row: MeetingInviteSourceRow): MeetingInviteSourceRecord {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind,
    chapterId: row.chapter_id === null ? null : Number(row.chapter_id),
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

export type InsertCreatingMeetingInput = {
  id: string;
  hostChapterId: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  accessType: MeetingAccessType;
  createdByUserId: string;
  createdByEmail: string;
  nowIso: string;
  sources: ReadonlyArray<{
    id: string;
    kind: InviteSourceKind;
    chapterId: number | null;
    email: string | null;
    role: InviteeRole;
  }>;
  invitees: readonly ResolvedInvitee[];
};

/** `meetings`（`creating`）・`meeting_invite_sources`・`meeting_invitees` を D1 batch で一括保存する。 */
export async function insertCreatingMeeting(
  db: D1Database,
  input: InsertCreatingMeetingInput,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO meetings (
           id, host_chapter_id, title, description, start_at, end_at, time_zone,
           access_type, status, created_by_user_id, created_by_email, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.hostChapterId,
        input.title,
        input.description,
        input.startAt,
        input.endAt,
        input.timeZone,
        input.accessType,
        input.createdByUserId,
        input.createdByEmail,
        input.nowIso,
        input.nowIso,
      ),
  ];

  for (const source of input.sources) {
    statements.push(
      db
        .prepare(
          `INSERT INTO meeting_invite_sources (
             id, meeting_id, kind, chapter_id, email, role, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          source.id,
          input.id,
          source.kind,
          source.chapterId,
          source.email,
          source.role,
          input.nowIso,
        ),
    );
  }

  for (const invitee of input.invitees) {
    statements.push(
      db
        .prepare(
          `INSERT INTO meeting_invitees (
             meeting_id, email_normalized, email, display_name, user_id, role, source_kinds
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          invitee.emailNormalized,
          invitee.email,
          invitee.displayName,
          invitee.userId,
          invitee.role,
          JSON.stringify(invitee.sourceKinds),
        ),
    );
  }

  await db.batch(statements);
}

/** `spaces.create` 完了直後にスペース情報を記録し、後続失敗時も参照を失わないようにする。 */
export async function updateMeetingSpace(
  db: D1Database,
  meetingId: string,
  space: { spaceName: string; meetingUri: string; meetingCode: string; updatedAt: string },
): Promise<void> {
  await db
    .prepare(
      "UPDATE meetings SET space_name = ?, meeting_uri = ?, meeting_code = ?, updated_at = ? WHERE id = ?",
    )
    .bind(space.spaceName, space.meetingUri, space.meetingCode, space.updatedAt, meetingId)
    .run();
}

/** スペース作成・Calendar 予定作成が完了した会議を `active` へ遷移する。 */
export async function markMeetingActive(
  db: D1Database,
  meetingId: string,
  params: {
    spaceName: string;
    meetingUri: string;
    meetingCode: string;
    calendarEventId: string;
    calendarHtmlLink: string | null;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE meetings
       SET status = 'active', space_name = ?, meeting_uri = ?, meeting_code = ?,
           calendar_event_id = ?, calendar_html_link = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      params.spaceName,
      params.meetingUri,
      params.meetingCode,
      params.calendarEventId,
      params.calendarHtmlLink,
      params.updatedAt,
      meetingId,
    )
    .run();
}

/** 作成フロー失敗時に `failed`・`last_error`・取得済みスペース情報を記録する。 */
export async function markMeetingFailed(
  db: D1Database,
  meetingId: string,
  params: {
    lastError: string;
    spaceName?: string | null;
    meetingUri?: string | null;
    meetingCode?: string | null;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE meetings
       SET status = 'failed', last_error = ?,
           space_name = COALESCE(?, space_name), meeting_uri = COALESCE(?, meeting_uri),
           meeting_code = COALESCE(?, meeting_code), updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      params.lastError,
      params.spaceName ?? null,
      params.meetingUri ?? null,
      params.meetingCode ?? null,
      params.updatedAt,
      meetingId,
    )
    .run();
}

/** メンバー同期ジョブ等のエラー・警告を `last_error` へ記録またはクリアする。 */
export async function updateMeetingLastError(
  db: D1Database,
  meetingId: string,
  lastError: string | null,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare("UPDATE meetings SET last_error = ?, updated_at = ? WHERE id = ?")
    .bind(lastError, updatedAt, meetingId)
    .run();
}

export async function getMeetingById(
  db: D1Database,
  meetingId: string,
): Promise<MeetingRecord | null> {
  const row = await db
    .prepare("SELECT * FROM meetings WHERE id = ?")
    .bind(meetingId)
    .first<MeetingRow>();
  return row ? mapMeetingRow(row) : null;
}

export async function listMeetingInvitees(
  db: D1Database,
  meetingId: string,
): Promise<MeetingInviteeRecord[]> {
  const result = await db
    .prepare(
      `SELECT meeting_id, email_normalized, email, display_name, user_id, role, source_kinds
       FROM meeting_invitees
       WHERE meeting_id = ?
       ORDER BY CASE role WHEN 'cohost' THEN 0 ELSE 1 END, COALESCE(display_name, email) ASC`,
    )
    .bind(meetingId)
    .all<MeetingInviteeRow>();
  return (result.results ?? []).map(mapInviteeRow);
}

export async function listMeetingInviteSources(
  db: D1Database,
  meetingId: string,
): Promise<MeetingInviteSourceRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, meeting_id, kind, chapter_id, email, role, created_at
       FROM meeting_invite_sources
       WHERE meeting_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(meetingId)
    .all<MeetingInviteSourceRow>();
  return (result.results ?? []).map(mapInviteSourceRow);
}

/**
 * 指定ユーザーが閲覧可能な会議一覧を取得する。
 * 管理者は全件、それ以外は作成者または正規化メール一致の招待者である会議のみ返す。
 */
export async function listVisibleMeetings(
  db: D1Database,
  params: { userId: string; emailNormalized: string; isAdmin: boolean },
): Promise<MeetingListItem[]> {
  const baseSelect =
    "SELECT m.*, mi.role AS my_role FROM meetings m LEFT JOIN meeting_invitees mi ON mi.meeting_id = m.id AND mi.email_normalized = ?";
  const result = params.isAdmin
    ? await db
        .prepare(`${baseSelect} ORDER BY m.start_at ASC`)
        .bind(params.emailNormalized)
        .all<MeetingListRow>()
    : await db
        .prepare(
          `${baseSelect} WHERE m.created_by_user_id = ? OR mi.email_normalized IS NOT NULL ORDER BY m.start_at ASC`,
        )
        .bind(params.emailNormalized, params.userId)
        .all<MeetingListRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    hostChapterId: Number(row.host_chapter_id),
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    timeZone: row.time_zone,
    accessType: row.access_type,
    meetingUri: row.meeting_uri,
    status: row.status,
    isCreator: row.created_by_user_id === params.userId,
    myRole: row.my_role ?? null,
  }));
}
