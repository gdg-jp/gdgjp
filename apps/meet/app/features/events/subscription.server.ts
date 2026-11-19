import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { getGoogleConnection } from "~/features/google/connection.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import {
  type WorkspaceEventSubscription,
  createSubscription,
  deleteSubscription,
  getSubscription,
  listSubscriptions,
  patchSubscriptionTtl,
  reactivateSubscription,
} from "~/features/google/workspace-events.server";
import { toSafeErrorSummary } from "~/features/meetings/invite-resolution.server";
import {
  GOOGLE_SUBSCRIPTION_ID,
  type GoogleSubscriptionRecord,
  getGoogleSubscription,
  upsertGoogleSubscription,
} from "./subscription.repository.server";

export {
  GOOGLE_SUBSCRIPTION_ID,
  type GoogleSubscriptionRecord,
  getGoogleSubscription,
  upsertGoogleSubscription,
};

export const SUBSCRIPTION_RENEW_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

/** 本番で購読する Workspace Events の 4 イベント型。 */
export const WORKSPACE_EVENT_TYPES = [
  "google.workspace.meet.conference.v2.ended",
  "google.workspace.meet.recording.v2.fileGenerated",
  "google.workspace.meet.transcript.v2.fileGenerated",
  "google.workspace.meet.smartNote.v2.fileGenerated",
] as const;

export type SubscriptionDeps = {
  fetchFn?: GoogleFetch;
  now?: () => Date;
  forceRenew?: boolean;
  forceRecreate?: boolean;
};

export type EnsureSubscriptionResult =
  | { ok: false; reason: "not_connected" | "missing_topic" }
  | {
      ok: true;
      action: "kept" | "extended" | "created" | "adopted_and_extended" | "recreated";
      subscription: GoogleSubscriptionRecord;
    };

/**
 * ユーザー対象の Workspace Events 購読を一覧検索するときのフィルタ文字列を組み立てる。
 * `target_resource` 単体では 400 INVALID_ARGUMENT になるため `event_types` と AND 結合する（00a §7-2）。
 */
export function buildUserSubscriptionFilter(targetResource: string): string {
  return `event_types:"google.workspace.meet.conference.v2.ended" AND target_resource="${targetResource}"`;
}

function hasExactEventTypes(actual: readonly string[] | undefined): boolean {
  if (!actual || actual.length !== WORKSPACE_EVENT_TYPES.length) return false;
  const set = new Set(actual);
  return WORKSPACE_EVENT_TYPES.every((eventType) => set.has(eventType));
}

function matchesDesiredSubscription(
  sub: WorkspaceEventSubscription,
  expectedTopic: string,
): boolean {
  return (
    sub.notificationEndpoint?.pubsubTopic === expectedTopic && hasExactEventTypes(sub.eventTypes)
  );
}

function isExpiredOrMissingSubscriptionError(error: GoogleApiError): boolean {
  return (
    error.httpStatus === 400 ||
    error.httpStatus === 404 ||
    error.httpStatus === 410 ||
    error.apiStatus === "NOT_FOUND" ||
    error.apiStatus === "FAILED_PRECONDITION"
  );
}

function isAlreadyExistsError(error: GoogleApiError): boolean {
  return error.httpStatus === 409 || error.apiStatus === "ALREADY_EXISTS";
}

function toSubscriptionRecord(
  sub: WorkspaceEventSubscription,
  nowIso: string,
  fallbackExpireTime?: string,
): GoogleSubscriptionRecord {
  return {
    name: sub.name,
    state: sub.state ?? "ACTIVE",
    expireTime: sub.expireTime ?? fallbackExpireTime ?? nowIso,
    updatedAt: nowIso,
    lastError: null,
  };
}

async function resolveOperationSubscription(
  accessToken: string,
  result: { subscription: WorkspaceEventSubscription | null },
  fallbackName: string | null,
  fetchFn: GoogleFetch,
): Promise<WorkspaceEventSubscription> {
  if (result.subscription) return result.subscription;
  if (fallbackName) {
    return getSubscription(accessToken, fallbackName, fetchFn);
  }
  throw new Error("Workspace Events 購読オペレーションから購読情報を取得できませんでした");
}

async function createAndSaveSubscription(
  db: D1Database,
  accessToken: string,
  targetResource: string,
  pubsubTopic: string,
  fetchFn: GoogleFetch,
  nowIso: string,
): Promise<GoogleSubscriptionRecord> {
  const op = await createSubscription(
    accessToken,
    {
      targetResource,
      eventTypes: [...WORKSPACE_EVENT_TYPES],
      pubsubTopic,
      includeResource: false,
    },
    fetchFn,
  );
  const sub = await resolveOperationSubscription(accessToken, op, null, fetchFn);
  return upsertGoogleSubscription(db, toSubscriptionRecord(sub, nowIso));
}

async function extendAndSaveSubscription(
  db: D1Database,
  accessToken: string,
  name: string,
  fallbackExpireTime: string | undefined,
  fetchFn: GoogleFetch,
  nowIso: string,
): Promise<GoogleSubscriptionRecord> {
  const op = await patchSubscriptionTtl(accessToken, name, "0s", fetchFn);
  const extended = await resolveOperationSubscription(accessToken, op, name, fetchFn);
  return upsertGoogleSubscription(db, toSubscriptionRecord(extended, nowIso, fallbackExpireTime));
}

async function createOrAdoptSubscription(
  env: Env,
  accessToken: string,
  targetResource: string,
  pubsubTopic: string,
  fetchFn: GoogleFetch,
  nowIso: string,
): Promise<{
  action: "created" | "adopted_and_extended" | "recreated";
  subscription: GoogleSubscriptionRecord;
}> {
  try {
    const saved = await createAndSaveSubscription(
      env.DB,
      accessToken,
      targetResource,
      pubsubTopic,
      fetchFn,
      nowIso,
    );
    return { action: "created", subscription: saved };
  } catch (error) {
    if (!(error instanceof GoogleApiError && isAlreadyExistsError(error))) {
      throw error;
    }

    // 同一ユーザー対象の購読が既に存在する場合（00a §7-2）、一覧から見つけて採用または再作成する。
    const existingList = await listSubscriptions(
      accessToken,
      buildUserSubscriptionFilter(targetResource),
      fetchFn,
    );
    const found =
      existingList.find((sub) => sub.targetResource === targetResource) ?? existingList[0];
    if (!found) {
      throw new Error(
        "409 ALREADY_EXISTS が返されましたが、既存の Workspace Events 購読を取得できませんでした",
      );
    }

    if (matchesDesiredSubscription(found, pubsubTopic)) {
      await upsertGoogleSubscription(env.DB, toSubscriptionRecord(found, nowIso));
      const saved = await extendAndSaveSubscription(
        env.DB,
        accessToken,
        found.name,
        found.expireTime,
        fetchFn,
        nowIso,
      );
      return { action: "adopted_and_extended", subscription: saved };
    }

    await deleteSubscription(accessToken, found.name, fetchFn);
    const saved = await createAndSaveSubscription(
      env.DB,
      accessToken,
      targetResource,
      pubsubTopic,
      fetchFn,
      nowIso,
    );
    return { action: "recreated", subscription: saved };
  }
}

/**
 * 共有ホストアカウントに対する Workspace Events 購読（`id = 1`）を維持・延長・再作成する。
 */
export async function ensureSubscription(
  env: Env,
  deps: SubscriptionDeps = {},
): Promise<EnsureSubscriptionResult> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const nowDate = now();
  const nowIso = nowDate.toISOString();

  const connection = await getGoogleConnection(env.DB);
  if (!connection || connection.status !== "connected") {
    return { ok: false, reason: "not_connected" };
  }

  const pubsubTopic = env.GOOGLE_PUBSUB_TOPIC.trim();
  if (!pubsubTopic) {
    return { ok: false, reason: "missing_topic" };
  }

  const existing = await getGoogleSubscription(env.DB);
  const expireMs = existing ? Date.parse(existing.expireTime) : Number.NaN;
  const isHealthyAndFresh =
    existing !== null &&
    existing.state === "ACTIVE" &&
    Number.isFinite(expireMs) &&
    expireMs >= nowDate.getTime() + SUBSCRIPTION_RENEW_THRESHOLD_MS;

  if (isHealthyAndFresh && !deps.forceRenew && !deps.forceRecreate) {
    return { ok: true, action: "kept", subscription: existing };
  }

  const accessToken = await getGoogleAccessToken(env, fetchFn);
  const targetResource = `//cloudidentity.googleapis.com/users/${connection.google_user_id}`;

  if (existing && existing.state !== "DELETED" && !deps.forceRecreate) {
    try {
      const saved = await extendAndSaveSubscription(
        env.DB,
        accessToken,
        existing.name,
        existing.expireTime,
        fetchFn,
        nowIso,
      );
      return { ok: true, action: "extended", subscription: saved };
    } catch (error) {
      if (!(error instanceof GoogleApiError && isExpiredOrMissingSubscriptionError(error))) {
        await upsertGoogleSubscription(env.DB, {
          ...existing,
          updatedAt: nowIso,
          lastError: toSafeErrorSummary(error),
        });
        throw error;
      }
      // 期限切れ・削除済みの場合は新規作成へフォールバックする。
    }
  }

  try {
    const created = await createOrAdoptSubscription(
      env,
      accessToken,
      targetResource,
      pubsubTopic,
      fetchFn,
      nowIso,
    );
    return { ok: true, ...created };
  } catch (error) {
    if (existing) {
      await upsertGoogleSubscription(env.DB, {
        ...existing,
        updatedAt: nowIso,
        lastError: toSafeErrorSummary(error),
      });
    }
    throw error;
  }
}

/** `expirationReminder` ライフサイクル通知受信時に即座に TTL を延長して D1 を更新する。 */
export async function handleExpirationReminder(
  env: Env,
  subscriptionName: string | null,
  deps: Pick<SubscriptionDeps, "fetchFn" | "now"> = {},
): Promise<GoogleSubscriptionRecord | null> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const existing = await getGoogleSubscription(env.DB);
  const targetName = subscriptionName || existing?.name || null;
  if (!targetName) {
    const ensured = await ensureSubscription(env, { fetchFn, now: deps.now });
    return ensured.ok ? ensured.subscription : null;
  }

  const accessToken = await getGoogleAccessToken(env, fetchFn);
  return extendAndSaveSubscription(
    env.DB,
    accessToken,
    targetName,
    existing?.expireTime,
    fetchFn,
    nowIso,
  );
}

/** `expired` ライフサイクル通知受信時に購読を作り直す。 */
export async function handleSubscriptionExpired(
  env: Env,
  deps: Pick<SubscriptionDeps, "fetchFn" | "now"> = {},
): Promise<EnsureSubscriptionResult> {
  return ensureSubscription(env, { ...deps, forceRecreate: true });
}

/** `suspended` ライフサイクル通知受信時に SUSPENDED 状態を記録したうえで `reactivateSubscription` を試みる。 */
export async function handleSubscriptionSuspended(
  env: Env,
  subscriptionName: string | null,
  suspensionReason: string | null,
  deps: Pick<SubscriptionDeps, "fetchFn" | "now"> = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const existing = await getGoogleSubscription(env.DB);
  const targetName = subscriptionName || existing?.name || "subscriptions/unknown";
  const reasonText = suspensionReason
    ? `購読が一時停止されました (${suspensionReason})`.slice(0, 240)
    : "購読が一時停止されました";

  await upsertGoogleSubscription(env.DB, {
    name: targetName,
    state: "SUSPENDED",
    expireTime: existing?.expireTime ?? nowIso,
    updatedAt: nowIso,
    lastError: reasonText,
  });

  if (targetName === "subscriptions/unknown") return;

  try {
    const accessToken = await getGoogleAccessToken(env, fetchFn);
    const op = await reactivateSubscription(accessToken, targetName, fetchFn);
    const reactivated = await resolveOperationSubscription(accessToken, op, targetName, fetchFn);
    await upsertGoogleSubscription(
      env.DB,
      toSubscriptionRecord(reactivated, nowIso, existing?.expireTime),
    );
  } catch (error) {
    await upsertGoogleSubscription(env.DB, {
      name: targetName,
      state: "SUSPENDED",
      expireTime: existing?.expireTime ?? nowIso,
      updatedAt: nowIso,
      lastError: toSafeErrorSummary(error),
    });
  }
}
