import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import { getGoogleConnection } from "~/features/google/connection.server";
import { getGoogleAccessToken } from "~/features/google/token.server";
import {
  type WorkspaceEventSubscription,
  deleteSubscription,
  getSubscription,
  listSubscriptions,
} from "~/features/google/workspace-events.server";
import { toSafeErrorSummary } from "~/features/meetings/invite-resolution.server";
import {
  SUBSCRIPTION_RENEW_THRESHOLD_MS,
  WORKSPACE_EVENT_TYPES,
  createAndSaveSubscription,
  extendAndSaveSubscription,
  isAlreadyExistsError,
  isExpiredOrMissingSubscriptionError,
  isSubscriptionNotFoundError,
  matchesDesiredSubscription,
  needsRenewal,
  reactivateAndSaveSubscription,
  toSubscriptionRecord,
} from "./subscription-ops.server";
import {
  GOOGLE_SUBSCRIPTION_ID,
  type GoogleSubscriptionRecord,
  getGoogleSubscription,
  upsertGoogleSubscription,
} from "./subscription.repository.server";

export {
  GOOGLE_SUBSCRIPTION_ID,
  type GoogleSubscriptionRecord,
  SUBSCRIPTION_RENEW_THRESHOLD_MS,
  WORKSPACE_EVENT_TYPES,
  getGoogleSubscription,
  upsertGoogleSubscription,
};

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
      action:
        | "kept"
        | "extended"
        | "reactivated"
        | "created"
        | "adopted_and_extended"
        | "recreated";
      subscription: GoogleSubscriptionRecord;
    };

type RevivedAction = "kept" | "extended" | "reactivated";

/**
 * ユーザー対象の Workspace Events 購読を一覧検索するときのフィルタ文字列を組み立てる。
 * `target_resource` 単体では 400 INVALID_ARGUMENT になるため `event_types` と AND 結合する（00a §7-2）。
 */
export function buildUserSubscriptionFilter(targetResource: string): string {
  return `event_types:"google.workspace.meet.conference.v2.ended" AND target_resource="${targetResource}"`;
}

/** 失敗内容を、D1 に記録済みの最新の購読行（無ければ `fallback`）の `last_error` に残す。 */
async function recordSubscriptionFailure(
  db: D1Database,
  fallback: GoogleSubscriptionRecord | null,
  nowIso: string,
  error: unknown,
): Promise<void> {
  const current = (await getGoogleSubscription(db)) ?? fallback;
  if (!current) return;
  await upsertGoogleSubscription(db, {
    ...current,
    updatedAt: nowIso,
    lastError: toSafeErrorSummary(error),
  });
}

/**
 * D1 に記録済みの購読の実際の状態を `subscriptions.get` で確かめ、必要なら再有効化・延長する。
 * `suspended` ライフサイクル通知は通知先の権限エラーなどで届かないことがあるため、毎回 Google 側の状態を見る。
 * Google 側で見つからない・削除済み・延長が期限切れで失敗した場合は null を返し、呼び出し元で作り直す。
 */
async function reviveExistingSubscription(
  db: D1Database,
  accessToken: string,
  existing: GoogleSubscriptionRecord,
  options: { forceRenew: boolean; now: Date; nowIso: string; fetchFn: GoogleFetch },
): Promise<{ action: RevivedAction; subscription: GoogleSubscriptionRecord } | null> {
  const { forceRenew, now, nowIso, fetchFn } = options;
  let live: WorkspaceEventSubscription;
  try {
    live = await getSubscription(accessToken, existing.name, fetchFn);
  } catch (error) {
    if (isSubscriptionNotFoundError(error)) return null;
    throw error;
  }
  if (live.state === "DELETED") return null;

  let action: RevivedAction = "kept";
  let record = await upsertGoogleSubscription(
    db,
    toSubscriptionRecord(live, nowIso, existing.expireTime),
  );

  if (live.state === "SUSPENDED") {
    try {
      record = await reactivateAndSaveSubscription(
        db,
        accessToken,
        live.name,
        record.expireTime,
        fetchFn,
        nowIso,
      );
    } catch (error) {
      const reason = live.suspensionReason ?? "理由不明";
      throw new Error(
        `購読が一時停止されています（${reason}）。再有効化に失敗しました: ${toSafeErrorSummary(error)}`,
      );
    }
    action = "reactivated";
  }

  if (forceRenew || needsRenewal(record.expireTime, now)) {
    try {
      record = await extendAndSaveSubscription(
        db,
        accessToken,
        record.name,
        record.expireTime,
        fetchFn,
        nowIso,
      );
    } catch (error) {
      if (error instanceof GoogleApiError && isExpiredOrMissingSubscriptionError(error)) {
        return null;
      }
      throw error;
    }
    if (action === "kept") action = "extended";
  }

  return { action, subscription: record };
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
      const adopted = await upsertGoogleSubscription(env.DB, toSubscriptionRecord(found, nowIso));
      if (found.state === "SUSPENDED") {
        await reactivateAndSaveSubscription(
          env.DB,
          accessToken,
          found.name,
          adopted.expireTime,
          fetchFn,
          nowIso,
        );
      }
      const saved = await extendAndSaveSubscription(
        env.DB,
        accessToken,
        found.name,
        adopted.expireTime,
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
 * 共有ホストアカウントに対する Workspace Events 購読（`id = 1`）を維持・再有効化・延長・再作成する。
 * D1 に購読があれば毎回 `subscriptions.get` で実際の状態を確かめる（`reviveExistingSubscription`）。
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
  const accessToken = await getGoogleAccessToken(env, fetchFn);
  const targetResource = `//cloudidentity.googleapis.com/users/${connection.google_user_id}`;

  if (existing && existing.state !== "DELETED" && !deps.forceRecreate) {
    try {
      const revived = await reviveExistingSubscription(env.DB, accessToken, existing, {
        forceRenew: Boolean(deps.forceRenew),
        now: nowDate,
        nowIso,
        fetchFn,
      });
      if (revived) return { ok: true, ...revived };
      // Google 側で見つからない・期限切れの場合は新規作成へフォールバックする。
    } catch (error) {
      await recordSubscriptionFailure(env.DB, existing, nowIso, error);
      throw error;
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
    await recordSubscriptionFailure(env.DB, existing, nowIso, error);
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
    await reactivateAndSaveSubscription(
      env.DB,
      accessToken,
      targetName,
      existing?.expireTime,
      fetchFn,
      nowIso,
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
