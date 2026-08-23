import {
  decryptRefreshToken,
  getWorkspaceConnection,
  recordTokenVendAudit,
  reencryptWorkspaceConnectionIfStale,
  refreshWorkspaceAccessToken,
  reserveTokenVendQuota,
} from "~/lib/google-workspace.server";
import { requireCliTokenUser } from "~/lib/oauth-clients.server";
import type { Route } from "./+types/api.agents.google-workspace-token";

/**
 * Privileged token-vending endpoint: exchanges a caller-specified user's
 * stored Google Workspace refresh token for a short-lived access token.
 * Never returns the refresh token. Gated to the single pre-registered
 * `gdgagent-svc` GDG identity (env.AGENTS_SERVICE_ACCOUNT_USER_ID) — this is
 * an allowlist of one caller, not "any signed-in user can mint tokens for
 * anyone". The target userId is caller-supplied because the caller here is a
 * trusted privileged service (Phase 3's xangi authz-server), not a
 * sandboxed slot — see docs/agents-local-gws/01-accounts-workspace-link.md.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const env = context.cloudflare.env;

  const authorization = request.headers.get("Authorization");
  if (!authorization) return jsonError(401, "unauthorized");
  const caller = await requireCliTokenUser(env, authorization).catch(() => null);
  if (!caller) return jsonError(401, "unauthorized");

  const body = await request.json().catch(() => null);
  const targetUserId =
    body && typeof body === "object" && "userId" in body && typeof body.userId === "string"
      ? body.userId
      : null;
  if (!targetUserId) return jsonError(400, "invalid_request", "userId is required");

  if (caller.id !== env.AGENTS_SERVICE_ACCOUNT_USER_ID) {
    await recordTokenVendAudit(env.DB, caller.id, targetUserId, "forbidden_caller");
    return jsonError(403, "forbidden");
  }

  if (!(await reserveTokenVendQuota(env.DB, caller.id))) {
    await recordTokenVendAudit(env.DB, caller.id, targetUserId, "rate_limited");
    return jsonError(429, "rate_limited");
  }

  const connection = await getWorkspaceConnection(env.DB, targetUserId);
  if (!connection || connection.revokedAt) {
    await recordTokenVendAudit(env.DB, caller.id, targetUserId, "not_connected");
    return jsonError(404, "not_connected");
  }

  const refreshToken = await decryptRefreshToken(
    env,
    targetUserId,
    connection.encryptionKeyVersion,
    connection.refreshTokenCiphertext,
    connection.refreshTokenNonce,
  );
  const refreshed = await refreshWorkspaceAccessToken(env, refreshToken);
  if (!refreshed.ok) {
    await recordTokenVendAudit(env.DB, caller.id, targetUserId, "google_error");
    return jsonError(502, "google_error");
  }

  await reencryptWorkspaceConnectionIfStale(env, env.DB, targetUserId, connection, refreshToken);
  await recordTokenVendAudit(env.DB, caller.id, targetUserId, "ok");
  return Response.json(
    { access_token: refreshed.accessToken, expires_in: refreshed.expiresIn },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function jsonError(status: number, error: string, description?: string): Response {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
