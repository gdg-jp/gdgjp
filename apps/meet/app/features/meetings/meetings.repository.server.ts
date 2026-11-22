import type { ResolvedInvitee } from "./invitees";
import type {
  MeetingAccessType,
  MeetingInviteSourceRecord,
  MeetingInviteeRecord,
  MeetingListItem,
  MeetingRecord,
} from "./meeting";
import {
  type InsertInviteSourceItem,
  type MeetingInviteSourceRow,
  type MeetingInviteeRow,
  type MeetingListRow,
  type MeetingRow,
  buildInsertInviteSourceStatements,
  buildInsertInviteeStatements,
  mapInviteSourceRow,
  mapInviteeRow,
  mapMeetingRow,
} from "./meetings-mappers.server";

export type InsertCreatingMeetingInput = {
  id: string;
  hostChapterId: number;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  accessType: MeetingAccessType;
  autoTranscription: boolean;
  autoSmartNotes: boolean;
  autoRecording: boolean;
  createdByUserId: string;
  createdByEmail: string;
  nowIso: string;
  sources: readonly InsertInviteSourceItem[];
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
           access_type, auto_transcription, auto_smart_notes, auto_recording,
           status, created_by_user_id, created_by_email, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?)`,
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
        input.autoTranscription ? 1 : 0,
        input.autoSmartNotes ? 1 : 0,
        input.autoRecording ? 1 : 0,
        input.createdByUserId,
        input.createdByEmail,
        input.nowIso,
        input.nowIso,
      ),
    ...buildInsertInviteSourceStatements(db, input.id, input.sources, input.nowIso),
    ...buildInsertInviteeStatements(db, input.id, input.invitees),
  ];

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

/** 会議の基本情報（タイトル・説明・日時・タイムゾーン・アクセス種別・自動記録設定）を更新する。 */
export async function updateMeetingDetails(
  db: D1Database,
  meetingId: string,
  params: {
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    timeZone: string;
    accessType: MeetingAccessType;
    autoTranscription: boolean;
    autoSmartNotes: boolean;
    autoRecording: boolean;
    calendarHtmlLink?: string | null;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE meetings
       SET title = ?, description = ?, start_at = ?, end_at = ?, time_zone = ?,
           access_type = ?, auto_transcription = ?, auto_smart_notes = ?, auto_recording = ?,
           calendar_html_link = COALESCE(?, calendar_html_link), updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      params.title,
      params.description,
      params.startAt,
      params.endAt,
      params.timeZone,
      params.accessType,
      params.autoTranscription ? 1 : 0,
      params.autoSmartNotes ? 1 : 0,
      params.autoRecording ? 1 : 0,
      params.calendarHtmlLink ?? null,
      params.updatedAt,
      meetingId,
    )
    .run();
}

/** 編集時の招待元（`meeting_invite_sources`）と招待者（`meeting_invitees`）を D1 batch で差し替える。 */
export async function replaceMeetingInviteSourcesAndInvitees(
  db: D1Database,
  meetingId: string,
  params: {
    sources: readonly InsertInviteSourceItem[];
    invitees: readonly ResolvedInvitee[];
    nowIso: string;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM meeting_invite_sources WHERE meeting_id = ?").bind(meetingId),
    db.prepare("DELETE FROM meeting_invitees WHERE meeting_id = ?").bind(meetingId),
    ...buildInsertInviteSourceStatements(db, meetingId, params.sources, params.nowIso),
    ...buildInsertInviteeStatements(db, meetingId, params.invitees),
  ];

  await db.batch(statements);
}

/** チャプター再同期時の招待者スナップショット（`meeting_invitees`）と `meetings.updated_at` を D1 batch で差し替える。 */
export async function replaceMeetingInvitees(
  db: D1Database,
  meetingId: string,
  params: { invitees: readonly ResolvedInvitee[]; updatedAt: string },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM meeting_invitees WHERE meeting_id = ?").bind(meetingId),
    ...buildInsertInviteeStatements(db, meetingId, params.invitees),
    db.prepare("UPDATE meetings SET updated_at = ? WHERE id = ?").bind(params.updatedAt, meetingId),
  ];

  await db.batch(statements);
}

/** 取り消し完了時に `status = 'canceled'` と `canceled_at` を記録する。 */
export async function markMeetingCanceled(
  db: D1Database,
  meetingId: string,
  params: { canceledAt: string; updatedAt: string },
): Promise<void> {
  await db
    .prepare(
      "UPDATE meetings SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(params.canceledAt, params.updatedAt, meetingId)
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

/** Meet スペース名（`spaces/<id>`）から管理対象の会議を検索する。 */
export async function getMeetingBySpaceName(
  db: D1Database,
  spaceName: string,
): Promise<MeetingRecord | null> {
  const row = await db
    .prepare("SELECT * FROM meetings WHERE space_name = ?")
    .bind(spaceName)
    .first<MeetingRow>();
  return row ? mapMeetingRow(row) : null;
}

/** 過去一定期間内に開始済み・終了直後の `active` な会議（スペース設定済み）を取得する（毎時 cron の取りこぼし補完用）。 */
export async function listRecentActiveMeetingsWithSpace(
  db: D1Database,
  params: { sinceEndAtIso: string; nowIso: string },
): Promise<MeetingRecord[]> {
  const result = await db
    .prepare(
      `SELECT * FROM meetings
       WHERE status = 'active'
         AND end_at >= ?
         AND start_at <= ?
         AND space_name IS NOT NULL
       ORDER BY start_at DESC`,
    )
    .bind(params.sinceEndAtIso, params.nowIso)
    .all<MeetingRow>();
  return (result.results ?? []).map(mapMeetingRow);
}

export async function listMeetingInvitees(
  db: D1Database,
  meetingId: string,
): Promise<MeetingInviteeRecord[]> {
  const result = await db
    .prepare(
      `SELECT meeting_id, email_normalized, email, display_name, user_id, role, source_kinds, google_user
       FROM meeting_invitees
       WHERE meeting_id = ?
       ORDER BY CASE role WHEN 'cohost' THEN 0 ELSE 1 END, COALESCE(display_name, email) ASC`,
    )
    .bind(meetingId)
    .all<MeetingInviteeRow>();
  return (result.results ?? []).map(mapInviteeRow);
}

/** Meet スペースのメンバー名末尾から取得した `google_user`（`users/<id>` または `null`）を保存する。 */
export async function updateMeetingInviteeGoogleUsers(
  db: D1Database,
  meetingId: string,
  entries: ReadonlyArray<{ emailNormalized: string; googleUser: string | null }>,
): Promise<void> {
  if (entries.length === 0) return;
  const statements = entries.map((entry) =>
    db
      .prepare(
        "UPDATE meeting_invitees SET google_user = ? WHERE meeting_id = ? AND email_normalized = ?",
      )
      .bind(entry.googleUser, meetingId, entry.emailNormalized),
  );
  await db.batch(statements);
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
