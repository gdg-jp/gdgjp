import {
  type GoogleFetch,
  encodeResourcePath,
  googleJsonRequest,
  paginateAll,
} from "~/features/google/client.server";

const MEET_API_BASE = "https://meet.googleapis.com/v2";
const PARTICIPANTS_PAGE_SIZE = 250;
const TRANSCRIPT_ENTRIES_PAGE_SIZE = 100;

export type MeetParticipant = {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: {
    user?: string;
    displayName?: string;
  };
  anonymousUser?: {
    displayName?: string;
  };
  phoneUser?: {
    displayName?: string;
  };
};

export type MeetParticipantSession = {
  name: string;
  startTime?: string;
  endTime?: string;
};

export type MeetTranscriptEntry = {
  name: string;
  participant?: string;
  text?: string;
  languageCode?: string;
  startTime?: string;
  endTime?: string;
};

export type MeetTranscriptEntriesPage = {
  transcriptEntries: MeetTranscriptEntry[];
  nextPageToken?: string;
};

export function memberUserId(memberName: string): string | null {
  const match = /\/members\/(\d+)$/.exec(memberName.trim());
  return match ? `users/${match[1]}` : null;
}

export async function listParticipants(
  accessToken: string,
  conferenceRecordName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetParticipant[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams({ pageSize: String(PARTICIPANTS_PAGE_SIZE) });
      if (pageToken) params.set("pageToken", pageToken);
      const base = `${MEET_API_BASE}/${encodeResourcePath(conferenceRecordName)}/participants`;
      return googleJsonRequest<{ participants?: MeetParticipant[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: `${base}?${params.toString()}`,
        fetchFn,
      });
    },
    (page) => page.participants,
  );
}

/**
 * 参加者単位の `participantSessions` を `pageSize=250` で全ページ取得する。
 * ワイルドカード `participants/-/participantSessions` は常に空配列になるため使用しない。
 */
export async function listParticipantSessions(
  accessToken: string,
  participantName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetParticipantSession[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams({ pageSize: String(PARTICIPANTS_PAGE_SIZE) });
      if (pageToken) params.set("pageToken", pageToken);
      const base = `${MEET_API_BASE}/${encodeResourcePath(participantName)}/participantSessions`;
      return googleJsonRequest<{
        participantSessions?: MeetParticipantSession[];
        nextPageToken?: string;
      }>({
        accessToken,
        method: "GET",
        url: `${base}?${params.toString()}`,
        fetchFn,
      });
    },
    (page) => page.participantSessions,
  );
}

export async function listTranscriptEntries(
  accessToken: string,
  transcriptName: string,
  options: { pageToken?: string } = {},
  fetchFn?: GoogleFetch,
): Promise<MeetTranscriptEntriesPage> {
  const params = new URLSearchParams({ pageSize: String(TRANSCRIPT_ENTRIES_PAGE_SIZE) });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  const base = `${MEET_API_BASE}/${encodeResourcePath(transcriptName)}/entries`;
  const page = await googleJsonRequest<{
    transcriptEntries?: MeetTranscriptEntry[];
    nextPageToken?: string;
  }>({
    accessToken,
    method: "GET",
    url: `${base}?${params.toString()}`,
    fetchFn,
  });
  return {
    transcriptEntries: page.transcriptEntries ?? [],
    nextPageToken: page.nextPageToken,
  };
}
