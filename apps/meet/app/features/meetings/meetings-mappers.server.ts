import type { ResolvedInvitee } from "./invitees";
import type {
  InviteSourceKind,
  InviteeRole,
  InviteeSourceKind,
  MeetingAccessType,
  MeetingInviteSourceRecord,
  MeetingInviteeRecord,
  MeetingRecord,
  MeetingStatus,
} from "./meeting";

export type MeetingRow = {
  id: string;
  host_chapter_id: number;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  access_type: MeetingAccessType;
  auto_transcription: number;
  auto_smart_notes: number;
  auto_recording: number;
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

export type MeetingListRow = MeetingRow & {
  my_role: InviteeRole | null;
};

export type MeetingInviteSourceRow = {
  id: string;
  meeting_id: string;
  kind: InviteSourceKind;
  chapter_id: number | null;
  email: string | null;
  role: InviteeRole;
  created_at: string;
};

export type MeetingInviteeRow = {
  meeting_id: string;
  email_normalized: string;
  email: string;
  display_name: string | null;
  user_id: string | null;
  role: InviteeRole;
  source_kinds: string;
  google_user?: string | null;
};

export type InsertInviteSourceItem = {
  id: string;
  kind: InviteSourceKind;
  chapterId: number | null;
  email: string | null;
  role: InviteeRole;
};

export function mapMeetingRow(row: MeetingRow): MeetingRecord {
  return {
    id: row.id,
    hostChapterId: Number(row.host_chapter_id),
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    timeZone: row.time_zone,
    accessType: row.access_type,
    autoTranscription: Number(row.auto_transcription) === 1,
    autoSmartNotes: Number(row.auto_smart_notes) === 1,
    autoRecording: Number(row.auto_recording) === 1,
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
  } catch {}
  return [];
}

export function mapInviteeRow(row: MeetingInviteeRow): MeetingInviteeRecord {
  return {
    meetingId: row.meeting_id,
    emailNormalized: row.email_normalized,
    email: row.email,
    displayName: row.display_name,
    userId: row.user_id,
    role: row.role,
    sourceKinds: parseSourceKinds(row.source_kinds),
    googleUser: row.google_user ?? null,
  };
}

export function mapInviteSourceRow(row: MeetingInviteSourceRow): MeetingInviteSourceRecord {
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

export function buildInsertInviteSourceStatements(
  db: D1Database,
  meetingId: string,
  sources: readonly InsertInviteSourceItem[],
  createdAt: string,
): D1PreparedStatement[] {
  return sources.map((source) =>
    db
      .prepare(
        `INSERT INTO meeting_invite_sources (
           id, meeting_id, kind, chapter_id, email, role, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        source.id,
        meetingId,
        source.kind,
        source.chapterId,
        source.email,
        source.role,
        createdAt,
      ),
  );
}

export function buildInsertInviteeStatements(
  db: D1Database,
  meetingId: string,
  invitees: readonly ResolvedInvitee[],
): D1PreparedStatement[] {
  return invitees.map((invitee) =>
    db
      .prepare(
        `INSERT INTO meeting_invitees (
           meeting_id, email_normalized, email, display_name, user_id, role, source_kinds
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        meetingId,
        invitee.emailNormalized,
        invitee.email,
        invitee.displayName,
        invitee.userId,
        invitee.role,
        JSON.stringify(invitee.sourceKinds),
      ),
  );
}
