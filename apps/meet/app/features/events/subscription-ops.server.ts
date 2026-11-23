import { GoogleApiError, type GoogleFetch } from "~/features/google/client.server";
import {
  type WorkspaceEventSubscription,
  createSubscription,
  getSubscription,
  patchSubscriptionTtl,
  reactivateSubscription,
} from "~/features/google/workspace-events.server";
import {
  type GoogleSubscriptionRecord,
  upsertGoogleSubscription,
} from "./subscription.repository.server";

export const SUBSCRIPTION_RENEW_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

export const WORKSPACE_EVENT_TYPES = [
  "google.workspace.meet.conference.v2.ended",
  "google.workspace.meet.recording.v2.fileGenerated",
  "google.workspace.meet.transcript.v2.fileGenerated",
  "google.workspace.meet.smartNote.v2.fileGenerated",
] as const;

function hasExactEventTypes(actual: readonly string[] | undefined): boolean {
  if (!actual || actual.length !== WORKSPACE_EVENT_TYPES.length) return false;
  const set = new Set(actual);
  return WORKSPACE_EVENT_TYPES.every((eventType) => set.has(eventType));
}

export function matchesDesiredSubscription(
  sub: WorkspaceEventSubscription,
  expectedTopic: string,
): boolean {
  return (
    sub.notificationEndpoint?.pubsubTopic === expectedTopic && hasExactEventTypes(sub.eventTypes)
  );
}

export function isExpiredOrMissingSubscriptionError(error: GoogleApiError): boolean {
  return (
    error.httpStatus === 400 ||
    error.httpStatus === 404 ||
    error.httpStatus === 410 ||
    error.apiStatus === "NOT_FOUND" ||
    error.apiStatus === "FAILED_PRECONDITION"
  );
}

export function isSubscriptionNotFoundError(error: unknown): boolean {
  return (
    error instanceof GoogleApiError &&
    (error.httpStatus === 404 || error.httpStatus === 410 || error.apiStatus === "NOT_FOUND")
  );
}

export function isAlreadyExistsError(error: GoogleApiError): boolean {
  return error.httpStatus === 409 || error.apiStatus === "ALREADY_EXISTS";
}

export function needsRenewal(expireTime: string | undefined, now: Date): boolean {
  const expireMs = expireTime ? Date.parse(expireTime) : Number.NaN;
  return !Number.isFinite(expireMs) || expireMs < now.getTime() + SUBSCRIPTION_RENEW_THRESHOLD_MS;
}

export function toSubscriptionRecord(
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

export async function resolveOperationSubscription(
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

export async function createAndSaveSubscription(
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

export async function extendAndSaveSubscription(
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

export async function reactivateAndSaveSubscription(
  db: D1Database,
  accessToken: string,
  name: string,
  fallbackExpireTime: string | undefined,
  fetchFn: GoogleFetch,
  nowIso: string,
): Promise<GoogleSubscriptionRecord> {
  const op = await reactivateSubscription(accessToken, name, fetchFn);
  const reactivated = await resolveOperationSubscription(accessToken, op, name, fetchFn);
  return upsertGoogleSubscription(
    db,
    toSubscriptionRecord(reactivated, nowIso, fallbackExpireTime),
  );
}
