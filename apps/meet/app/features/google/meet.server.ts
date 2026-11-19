import {
  type GoogleFetch,
  encodeResourcePath,
  googleJsonRequest,
  paginateAll,
} from "~/features/google/client.server";

const MEET_API_BASE = "https://meet.googleapis.com/v2";

export type MeetAccessType = "RESTRICTED" | "TRUSTED" | "OPEN";
export type MeetModeration = "ON" | "OFF";
export type MeetMemberRole = "COHOST";

export type MeetSpaceConfig = {
  accessType?: MeetAccessType;
  moderation?: MeetModeration;
  entryPointAccess?: string;
};

export type MeetSpace = {
  name: string;
  meetingUri: string;
  meetingCode: string;
  config?: MeetSpaceConfig;
  activeConference?: { conferenceRecord?: string };
};

export type MeetSpaceMember = {
  name: string;
  email?: string;
  role?: string;
  user?: string;
};

export type MeetConferenceRecord = {
  name: string;
  startTime?: string;
  endTime?: string;
  expireTime?: string;
  space?: string;
};

export type MeetRecording = {
  name: string;
  state?: "STARTED" | "ENDED" | "FILE_GENERATED" | string;
  startTime?: string;
  endTime?: string;
  driveDestination?: {
    file?: string;
    exportUri?: string;
  };
};

export type MeetTranscript = {
  name: string;
  state?: "STARTED" | "ENDED" | "FILE_GENERATED" | string;
  startTime?: string;
  endTime?: string;
  docsDestination?: {
    document?: string;
    exportUri?: string;
  };
};

export type MeetSmartNote = {
  name: string;
  state?: "STARTED" | "ENDED" | "FILE_GENERATED" | string;
  startTime?: string;
  endTime?: string;
  docsDestination?: {
    document?: string;
    exportUri?: string;
  };
};

export async function createSpace(
  accessToken: string,
  config: { accessType: MeetAccessType; moderation?: MeetModeration },
  fetchFn?: GoogleFetch,
): Promise<MeetSpace> {
  return googleJsonRequest<MeetSpace>({
    accessToken,
    method: "POST",
    url: `${MEET_API_BASE}/spaces`,
    body: {
      config: {
        accessType: config.accessType,
        moderation: config.moderation ?? "ON",
      },
    },
    fetchFn,
  });
}

export async function getSpace(
  accessToken: string,
  spaceName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetSpace> {
  return googleJsonRequest<MeetSpace>({
    accessToken,
    method: "GET",
    url: `${MEET_API_BASE}/${encodeResourcePath(spaceName)}`,
    fetchFn,
  });
}

export async function patchSpace(
  accessToken: string,
  spaceName: string,
  config: { accessType?: MeetAccessType; moderation?: MeetModeration },
  updateMask = "config.accessType",
  fetchFn?: GoogleFetch,
): Promise<MeetSpace> {
  const params = new URLSearchParams({ updateMask });
  return googleJsonRequest<MeetSpace>({
    accessToken,
    method: "PATCH",
    url: `${MEET_API_BASE}/${encodeResourcePath(spaceName)}?${params.toString()}`,
    body: { config },
    fetchFn,
  });
}

export async function endActiveConference(
  accessToken: string,
  spaceName: string,
  fetchFn?: GoogleFetch,
): Promise<void> {
  await googleJsonRequest<unknown>({
    accessToken,
    method: "POST",
    url: `${MEET_API_BASE}/${encodeResourcePath(spaceName)}:endActiveConference`,
    body: {},
    fetchFn,
  });
}

export async function listSpaceMembers(
  accessToken: string,
  spaceName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetSpaceMember[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams();
      if (pageToken) params.set("pageToken", pageToken);
      const query = params.toString();
      const base = `${MEET_API_BASE}/${encodeResourcePath(spaceName)}/members`;
      return googleJsonRequest<{ members?: MeetSpaceMember[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: query ? `${base}?${query}` : base,
        fetchFn,
      });
    },
    (page) => page.members,
  );
}

export async function createSpaceMember(
  accessToken: string,
  spaceName: string,
  member: { email: string; role?: MeetMemberRole },
  fetchFn?: GoogleFetch,
): Promise<MeetSpaceMember> {
  // 通常の参加者（ノック不要）は role を省略して送信する（PoC 検証済み仕様）。
  const body = member.role ? { email: member.email, role: member.role } : { email: member.email };
  return googleJsonRequest<MeetSpaceMember>({
    accessToken,
    method: "POST",
    url: `${MEET_API_BASE}/${encodeResourcePath(spaceName)}/members`,
    body,
    fetchFn,
  });
}

export async function deleteSpaceMember(
  accessToken: string,
  memberName: string,
  fetchFn?: GoogleFetch,
): Promise<void> {
  await googleJsonRequest<unknown>({
    accessToken,
    method: "DELETE",
    url: `${MEET_API_BASE}/${encodeResourcePath(memberName)}`,
    fetchFn,
  });
}

export async function listConferenceRecords(
  accessToken: string,
  filter?: string,
  fetchFn?: GoogleFetch,
): Promise<MeetConferenceRecord[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams();
      if (filter) params.set("filter", filter);
      if (pageToken) params.set("pageToken", pageToken);
      const query = params.toString();
      const base = `${MEET_API_BASE}/conferenceRecords`;
      return googleJsonRequest<{
        conferenceRecords?: MeetConferenceRecord[];
        nextPageToken?: string;
      }>({
        accessToken,
        method: "GET",
        url: query ? `${base}?${query}` : base,
        fetchFn,
      });
    },
    (page) => page.conferenceRecords,
  );
}

export async function getConferenceRecord(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<MeetConferenceRecord> {
  return googleJsonRequest<MeetConferenceRecord>({
    accessToken,
    method: "GET",
    url: `${MEET_API_BASE}/${encodeResourcePath(name)}`,
    fetchFn,
  });
}

export async function listRecordings(
  accessToken: string,
  conferenceRecordName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetRecording[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams();
      if (pageToken) params.set("pageToken", pageToken);
      const query = params.toString();
      const base = `${MEET_API_BASE}/${encodeResourcePath(conferenceRecordName)}/recordings`;
      return googleJsonRequest<{ recordings?: MeetRecording[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: query ? `${base}?${query}` : base,
        fetchFn,
      });
    },
    (page) => page.recordings,
  );
}

export async function getRecording(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<MeetRecording> {
  return googleJsonRequest<MeetRecording>({
    accessToken,
    method: "GET",
    url: `${MEET_API_BASE}/${encodeResourcePath(name)}`,
    fetchFn,
  });
}

export async function listTranscripts(
  accessToken: string,
  conferenceRecordName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetTranscript[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams();
      if (pageToken) params.set("pageToken", pageToken);
      const query = params.toString();
      const base = `${MEET_API_BASE}/${encodeResourcePath(conferenceRecordName)}/transcripts`;
      return googleJsonRequest<{ transcripts?: MeetTranscript[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: query ? `${base}?${query}` : base,
        fetchFn,
      });
    },
    (page) => page.transcripts,
  );
}

export async function getTranscript(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<MeetTranscript> {
  return googleJsonRequest<MeetTranscript>({
    accessToken,
    method: "GET",
    url: `${MEET_API_BASE}/${encodeResourcePath(name)}`,
    fetchFn,
  });
}

export async function listSmartNotes(
  accessToken: string,
  conferenceRecordName: string,
  fetchFn?: GoogleFetch,
): Promise<MeetSmartNote[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams();
      if (pageToken) params.set("pageToken", pageToken);
      const query = params.toString();
      const base = `${MEET_API_BASE}/${encodeResourcePath(conferenceRecordName)}/smartNotes`;
      return googleJsonRequest<{ smartNotes?: MeetSmartNote[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: query ? `${base}?${query}` : base,
        fetchFn,
      });
    },
    (page) => page.smartNotes,
  );
}

export async function getSmartNote(
  accessToken: string,
  name: string,
  fetchFn?: GoogleFetch,
): Promise<MeetSmartNote> {
  return googleJsonRequest<MeetSmartNote>({
    accessToken,
    method: "GET",
    url: `${MEET_API_BASE}/${encodeResourcePath(name)}`,
    fetchFn,
  });
}
