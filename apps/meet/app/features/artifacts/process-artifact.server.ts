import type { GoogleFetch } from "~/features/google/client.server";
import { type DriveFile, getFile, listFiles } from "~/features/google/drive.server";
import { getRecording, getSmartNote, getTranscript } from "~/features/google/meet.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import type { ArtifactJobKind } from "~/features/jobs/types";
import { getMeetingById } from "~/features/meetings/meetings.repository.server";
import { ensureTranscriptStatsPending } from "~/features/stats/repository.server";
import type { ArtifactKind, ArtifactRecord } from "./artifact";
import { upsertArtifact } from "./repository.server";

const DRIVE_FILE_FIELDS = "id,name,mimeType,parents,webViewLink,createdTime";
const DRIVE_CHAT_LIST_FIELDS = "nextPageToken,files(id,name,mimeType,webViewLink,createdTime)";
const CHAT_LOG_TIME_WINDOW_MS = 120_000;

export type ProcessArtifactInput = {
  meetingId: string;
  kind: ArtifactJobKind;
  conferenceRecord: string;
  resourceName: string;
};

export type ProcessArtifactDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
  generateId?: () => string;
};

function escapeDriveQueryLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function defaultWebViewLink(fileId: string, kind: ArtifactKind): string {
  const encoded = encodeURIComponent(fileId);
  if (kind === "notes") {
    return `https://docs.google.com/document/d/${encoded}/edit`;
  }
  return `https://drive.google.com/file/d/${encoded}/view`;
}

function defaultMimeType(kind: ArtifactKind): string {
  if (kind === "recording") return "video/mp4";
  if (kind === "notes") return "application/vnd.google-apps.document";
  return "text/plain";
}

export function findMatchingChatLogFile(
  recordingFile: DriveFile,
  candidates: readonly DriveFile[],
): DriveFile | null {
  const recordingName = recordingFile.name?.trim();
  const recordingCreatedMs = recordingFile.createdTime
    ? Date.parse(recordingFile.createdTime)
    : Number.NaN;
  if (!recordingName || !Number.isFinite(recordingCreatedMs)) {
    return null;
  }

  let best: { file: DriveFile; diffMs: number } | null = null;
  for (const file of candidates) {
    if (file.id === recordingFile.id) continue;
    if (file.mimeType !== "text/plain") continue;
    if (!file.name || !file.name.startsWith(recordingName)) continue;
    if (!file.createdTime) continue;
    const candidateMs = Date.parse(file.createdTime);
    if (!Number.isFinite(candidateMs)) continue;

    const diffMs = Math.abs(candidateMs - recordingCreatedMs);
    if (diffMs > CHAT_LOG_TIME_WINDOW_MS) continue;

    if (!best || diffMs < best.diffMs) {
      best = { file, diffMs };
    }
  }
  return best?.file ?? null;
}

async function resolveMeetArtifactFile(
  accessToken: string,
  kind: ArtifactJobKind,
  resourceName: string,
  fetchFn: GoogleFetch,
): Promise<{ fileId: string; artifactKind: ArtifactKind }> {
  if (kind === "recording") {
    const rec = await getRecording(accessToken, resourceName, fetchFn);
    if (rec.state !== "FILE_GENERATED") {
      throw new Error(`録画ファイルがまだ生成完了していません (state=${rec.state ?? "unknown"})`);
    }
    const fileId = rec.driveDestination?.file?.trim();
    if (!fileId) {
      throw new Error("録画の driveDestination.file が空です");
    }
    return { fileId, artifactKind: "recording" };
  }

  if (kind === "transcript") {
    const tr = await getTranscript(accessToken, resourceName, fetchFn);
    if (tr.state !== "FILE_GENERATED") {
      throw new Error(`文字起こしがまだ生成完了していません (state=${tr.state ?? "unknown"})`);
    }
    const fileId = tr.docsDestination?.document?.trim();
    if (!fileId) {
      throw new Error("文字起こしの docsDestination.document が空です");
    }
    return { fileId, artifactKind: "notes" };
  }

  const sn = await getSmartNote(accessToken, resourceName, fetchFn);
  if (sn.state !== "FILE_GENERATED") {
    throw new Error(`Gemini メモがまだ生成完了していません (state=${sn.state ?? "unknown"})`);
  }
  const fileId = sn.docsDestination?.document?.trim();
  if (!fileId) {
    throw new Error("Gemini メモの docsDestination.document が空です");
  }
  return { fileId, artifactKind: "notes" };
}

export async function processArtifactJob(
  env: Env,
  input: ProcessArtifactInput,
  deps: ProcessArtifactDeps = {},
): Promise<ArtifactRecord[]> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const generateId = deps.generateId ?? (() => crypto.randomUUID());

  const meeting = await getMeetingById(env.DB, input.meetingId);
  if (!meeting) {
    return [];
  }

  const accessToken = await getGoogleAccessToken(env, fetchFn);
  const { fileId, artifactKind } = await resolveMeetArtifactFile(
    accessToken,
    input.kind,
    input.resourceName,
    fetchFn,
  );

  const driveFile = await getFile(accessToken, fileId, DRIVE_FILE_FIELDS, fetchFn);
  const savedMain = await upsertArtifact(env.DB, {
    id: generateId(),
    meetingId: input.meetingId,
    conferenceRecord: input.conferenceRecord,
    kind: artifactKind,
    driveFileId: fileId,
    title: driveFile.name?.trim() || fileId,
    mimeType: driveFile.mimeType?.trim() || defaultMimeType(artifactKind),
    webViewLink: driveFile.webViewLink?.trim() || defaultWebViewLink(fileId, artifactKind),
    createdAt: driveFile.createdTime?.trim() || now().toISOString(),
  });

  const savedArtifacts: ArtifactRecord[] = [savedMain];

  if (input.kind === "recording" && driveFile.parents && driveFile.parents.length > 0) {
    const parentId = driveFile.parents[0];
    const query = `'${escapeDriveQueryLiteral(parentId)}' in parents and trashed = false and mimeType = 'text/plain'`;
    const candidates = await listFiles(
      accessToken,
      { q: query, fields: DRIVE_CHAT_LIST_FIELDS },
      fetchFn,
    );
    const chatFile = findMatchingChatLogFile(driveFile, candidates);
    if (chatFile) {
      const savedChat = await upsertArtifact(env.DB, {
        id: generateId(),
        meetingId: input.meetingId,
        conferenceRecord: input.conferenceRecord,
        kind: "chat_log",
        driveFileId: chatFile.id,
        title: chatFile.name?.trim() || chatFile.id,
        mimeType: chatFile.mimeType?.trim() || "text/plain",
        webViewLink: chatFile.webViewLink?.trim() || defaultWebViewLink(chatFile.id, "chat_log"),
        createdAt: chatFile.createdTime?.trim() || now().toISOString(),
      });
      savedArtifacts.push(savedChat);
    }
  }

  for (const artifact of savedArtifacts) {
    if (artifact.sharedAt === null || artifact.attachedAt === null) {
      await env.MEET_JOBS.send({ type: "share_artifact", artifactId: artifact.id });
    }
  }

  if (input.kind === "transcript") {
    const transcriptStats = await ensureTranscriptStatsPending(
      env.DB,
      input.resourceName,
      input.conferenceRecord,
    );
    if (transcriptStats.status === "pending") {
      await env.MEET_JOBS.send({
        type: "collect_transcript_stats",
        conferenceRecord: input.conferenceRecord,
        transcript: input.resourceName,
      });
    }
  }

  return savedArtifacts;
}
