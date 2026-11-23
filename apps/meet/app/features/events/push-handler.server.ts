import {
  getConferenceRecordByName,
  upsertConferenceRecord,
} from "~/features/artifacts/repository.server";
import type { GoogleFetch } from "~/features/google/client.server";
import { getConferenceRecord } from "~/features/google/meet.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import type { ArtifactJobKind } from "~/features/jobs/types";
import { getMeetingBySpaceName } from "~/features/meetings/meetings.repository.server";
import {
  handleExpirationReminder,
  handleSubscriptionExpired,
  handleSubscriptionSuspended,
} from "./subscription.server";

const EVENT_CONFERENCE_ENDED = "google.workspace.meet.conference.v2.ended";
const EVENT_RECORDING_GENERATED = "google.workspace.meet.recording.v2.fileGenerated";
const EVENT_TRANSCRIPT_GENERATED = "google.workspace.meet.transcript.v2.fileGenerated";
const EVENT_SMART_NOTE_GENERATED = "google.workspace.meet.smartNote.v2.fileGenerated";

const LIFECYCLE_EXPIRATION_REMINDER = "google.workspace.events.subscription.v1.expirationReminder";
const LIFECYCLE_EXPIRED = "google.workspace.events.subscription.v1.expired";
const LIFECYCLE_SUSPENDED = "google.workspace.events.subscription.v1.suspended";

export type PubsubPushEnvelope = {
  message?: {
    attributes?: Record<string, string>;
    data?: string;
    messageId?: string;
  };
  subscription?: string;
};

export type PushHandlerDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
};

export type PushHandlerResult = {
  status: 204 | 500;
  action:
    | "invalid_envelope"
    | "invalid_data"
    | "ignored_event_type"
    | "invalid_resource"
    | "duplicate"
    | "unmanaged_space"
    | "recorded_conference"
    | "enqueued"
    | "lifecycle_handled"
    | "error";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64Json(
  base64: string,
): { ok: true; data: Record<string, unknown> } | { ok: false } {
  const cleaned = base64.replace(/\s+/g, "");
  if (!cleaned) return { ok: false };
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) return { ok: false };
    return { ok: true, data: parsed };
  } catch {
    return { ok: false };
  }
}

function normalizeSubscriptionName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^\/\/workspaceevents\.googleapis\.com\//, "");
  return trimmed.length > 0 ? trimmed : null;
}

function extractNestedName(payload: Record<string, unknown>, key: string): string | null {
  const nested = payload[key];
  if (!isRecord(nested) || typeof nested.name !== "string") return null;
  const trimmed = nested.name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractConferenceRecordName(resourceName: string): string | null {
  const match = /^(conferenceRecords\/[^/]+)(?:\/|$)/.exec(resourceName);
  return match ? match[1] : null;
}

async function tryInsertProcessedEvent(
  db: D1Database,
  dedupeKey: string,
  receivedAt: string,
): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO processed_events (dedupe_key, received_at) VALUES (?, ?)")
    .bind(dedupeKey, receivedAt)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function deleteProcessedEvent(db: D1Database, dedupeKey: string): Promise<void> {
  await db.prepare("DELETE FROM processed_events WHERE dedupe_key = ?").bind(dedupeKey).run();
}

function resolveTargetEvent(
  ceType: string,
  payload: Record<string, unknown>,
): { kind: ArtifactJobKind | null; resourceName: string | null } | null {
  switch (ceType) {
    case EVENT_CONFERENCE_ENDED:
      return { kind: null, resourceName: extractNestedName(payload, "conferenceRecord") };
    case EVENT_RECORDING_GENERATED:
      return { kind: "recording", resourceName: extractNestedName(payload, "recording") };
    case EVENT_TRANSCRIPT_GENERATED:
      return { kind: "transcript", resourceName: extractNestedName(payload, "transcript") };
    case EVENT_SMART_NOTE_GENERATED:
      return { kind: "smartNote", resourceName: extractNestedName(payload, "smartNote") };
    default:
      return null;
  }
}

/**
 * Pub/Sub Push のエンベロープ本体を処理する内部ハンドラ。
 * `/api/google/events`（JWT 検証済み）および開発専用の `/dev/simulate-event` から呼ばれる。
 */
export async function processPubsubEnvelope(
  env: Env,
  envelope: unknown,
  deps: PushHandlerDeps = {},
): Promise<PushHandlerResult> {
  if (!isRecord(envelope) || !isRecord(envelope.message)) {
    console.warn("[meet-events] invalid Pub/Sub envelope, acking with 204");
    return { status: 204, action: "invalid_envelope" };
  }

  const message = envelope.message;
  const attributes = isRecord(message.attributes)
    ? (message.attributes as Record<string, unknown>)
    : {};
  const ceType = typeof attributes["ce-type"] === "string" ? attributes["ce-type"].trim() : "";
  if (!ceType) {
    console.warn("[meet-events] missing ce-type attribute, acking with 204");
    return { status: 204, action: "invalid_envelope" };
  }

  let payload: Record<string, unknown> = {};
  if (message.data !== undefined && message.data !== "") {
    if (typeof message.data !== "string") {
      console.warn("[meet-events] non-string message.data, acking with 204");
      return { status: 204, action: "invalid_data" };
    }
    const decoded = decodeBase64Json(message.data);
    if (!decoded.ok) {
      console.warn("[meet-events] failed to decode message.data, acking with 204");
      return { status: 204, action: "invalid_data" };
    }
    payload = decoded.data;
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  // ライフサイクル通知（期限延長・再作成・一時停止）
  if (
    ceType === LIFECYCLE_EXPIRATION_REMINDER ||
    ceType === LIFECYCLE_EXPIRED ||
    ceType === LIFECYCLE_SUSPENDED
  ) {
    const subFromPayload = extractNestedName(payload, "subscription");
    const subName =
      normalizeSubscriptionName(subFromPayload) ??
      normalizeSubscriptionName(attributes["ce-subject"]);
    try {
      if (ceType === LIFECYCLE_EXPIRATION_REMINDER) {
        await handleExpirationReminder(env, subName, { fetchFn, now });
      } else if (ceType === LIFECYCLE_EXPIRED) {
        await handleSubscriptionExpired(env, { fetchFn, now });
      } else {
        const subObj = isRecord(payload.subscription) ? payload.subscription : null;
        const reason =
          subObj && typeof subObj.suspensionReason === "string" ? subObj.suspensionReason : null;
        await handleSubscriptionSuspended(env, subName, reason, { fetchFn, now });
      }
      return { status: 204, action: "lifecycle_handled" };
    } catch (error) {
      console.error("[meet-events] lifecycle event handling failed:", ceType, error);
      return { status: 500, action: "error" };
    }
  }

  const target = resolveTargetEvent(ceType, payload);
  if (!target) {
    return { status: 204, action: "ignored_event_type" };
  }

  if (!target.resourceName) {
    console.warn("[meet-events] missing resource name for event:", ceType);
    return { status: 204, action: "invalid_resource" };
  }

  const conferenceRecordName = extractConferenceRecordName(target.resourceName);
  if (!conferenceRecordName) {
    console.warn("[meet-events] invalid conferenceRecord resource name:", target.resourceName);
    return { status: 204, action: "invalid_resource" };
  }

  const dedupeKey = `${ceType}|${target.resourceName}`;
  const inserted = await tryInsertProcessedEvent(env.DB, dedupeKey, now().toISOString());
  if (!inserted) {
    return { status: 204, action: "duplicate" };
  }

  try {
    const existingRecord = await getConferenceRecordByName(env.DB, conferenceRecordName);
    let meetingId = existingRecord?.meetingId ?? null;

    if (!meetingId || ceType === EVENT_CONFERENCE_ENDED) {
      const accessToken = await getGoogleAccessToken(env, fetchFn);
      const remoteRecord = await getConferenceRecord(accessToken, conferenceRecordName, fetchFn);

      if (!meetingId) {
        if (!remoteRecord.space) {
          return { status: 204, action: "unmanaged_space" };
        }
        const meeting = await getMeetingBySpaceName(env.DB, remoteRecord.space);
        // アプリ管理外スペースの通知は決して保存・共有しない。
        if (!meeting) {
          return { status: 204, action: "unmanaged_space" };
        }
        meetingId = meeting.id;
      }

      await upsertConferenceRecord(env.DB, {
        name: conferenceRecordName,
        meetingId,
        startTime: remoteRecord.startTime ?? null,
        endTime: remoteRecord.endTime ?? null,
        expireTime: remoteRecord.expireTime ?? null,
      });
    }

    if (target.kind !== null) {
      await env.MEET_JOBS.send({
        type: "process_artifact",
        meetingId,
        kind: target.kind,
        conferenceRecord: conferenceRecordName,
        resourceName: target.resourceName,
      });
      return { status: 204, action: "enqueued" };
    }

    if (ceType === EVENT_CONFERENCE_ENDED) {
      await env.MEET_JOBS.send(
        {
          type: "collect_conference_stats",
          conferenceRecord: conferenceRecordName,
        },
        { delaySeconds: 120 },
      );
    }

    return { status: 204, action: "recorded_conference" };
  } catch (error) {
    // 6〜7 の処理失敗時は重複排除行を削除して 500 を返し、Pub/Sub の再送で再処理できるようにする。
    try {
      await deleteProcessedEvent(env.DB, dedupeKey);
    } catch (rollbackError) {
      console.error("[meet-events] failed to rollback processed_events:", dedupeKey, rollbackError);
    }
    console.error("[meet-events] event processing failed:", ceType, target.resourceName, error);
    return { status: 500, action: "error" };
  }
}

/** HTTP リクエスト本文文字列を安全にパースして `processPubsubEnvelope` へ渡す。 */
export async function handleRawPubsubPushBody(
  env: Env,
  rawBody: string,
  deps: PushHandlerDeps = {},
): Promise<PushHandlerResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.warn("[meet-events] malformed JSON body, acking with 204");
    return { status: 204, action: "invalid_envelope" };
  }
  return processPubsubEnvelope(env, parsed, deps);
}
