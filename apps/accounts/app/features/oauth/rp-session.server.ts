import { CHAPTERS_CLAIM, IS_ADMIN_CLAIM } from "@gdgjp/gdg-lib/auth/claims";
import { listActiveChaptersForUser } from "~/features/memberships/repository.server";
import { sha256Base64Url } from "~/lib/crypto.server";

/**
 * First-party session check (`POST /api/rp/v1/session`).
 *
 * Every `*.gdgs.jp` relying party asks this on each authenticated request
 * whether the IdP session its own session is bound to is still alive, and for
 * the user's current claims. Sign-out, account switching, admin revocation,
 * and role or membership changes therefore reach every app on its next
 * request instead of when a 30-day RP cookie expires.
 *
 * Callers authenticate with their client credentials (HTTP Basic) and must be
 * a configured first-party client; third-party developer apps are refused.
 */
export async function handleRpSessionCheck(env: Env, request: Request): Promise<Response> {
  const clientId = await authenticateFirstPartyClient(env, request);
  if (!clientId) return json({ error: "invalid_client" }, 401);

  let body: { sid?: unknown; sub?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (typeof body.sid !== "string" || !body.sid || typeof body.sub !== "string" || !body.sub) {
    return json({ error: "invalid_request" }, 400);
  }

  const row = await env.DB.prepare(
    `SELECT s."id" AS sessionId, s."userId" AS userId, s."expiresAt" AS expiresAt,
            u.email AS email, u.name AS name, u.image AS image,
            u.email_verified AS emailVerified, u.is_admin AS isAdmin
     FROM "session" s JOIN "user" u ON u.id = s."userId"
     WHERE s."id" = ? LIMIT 1`,
  )
    .bind(body.sid)
    .first<SessionUserRow>();

  if (!row || row.userId !== body.sub) return json({ active: false });
  const expiresAt = Date.parse(row.expiresAt);
  if (!(expiresAt > Date.now())) {
    // Ending the expired session fires the token-revocation trigger, so its
    // OAuth grants stop refreshing as well.
    await env.DB.prepare('DELETE FROM "session" WHERE "id" = ?').bind(row.sessionId).run();
    return json({ active: false });
  }

  const chapters = await listActiveChaptersForUser(env.DB, row.userId);
  return json({
    active: true,
    sub: row.userId,
    email: row.email,
    email_verified: row.emailVerified === 1,
    name: row.name,
    picture: row.image,
    [CHAPTERS_CLAIM]: chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterSlug: chapter.chapterSlug,
      role: chapter.role,
    })),
    [IS_ADMIN_CLAIM]: row.isAdmin === 1,
    session_expires_at: expiresAt,
  });
}

type SessionUserRow = {
  sessionId: string;
  userId: string;
  expiresAt: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: number;
  isAdmin: number;
};

/** Client IDs of the `*.gdgs.jp` relying parties built on gdg-lib. */
export function firstPartyRpClientIds(env: Env): string[] {
  return [
    env.TINYURL_CLIENT_ID,
    env.WIKI_CLIENT_ID,
    env.IMG_CLIENT_ID,
    env.SCHEDULER_CLIENT_ID,
    env.SNS_CLIENT_ID,
    env.PAY_CLIENT_ID,
    env.OST_CLIENT_ID,
    env.ROSTER_CLIENT_ID,
    env.MC_CLIENT_ID,
    env.SCREEN_CLIENT_ID,
    env.DECK_CLIENT_ID,
    env.ROULETTE_CLIENT_ID,
  ].filter(Boolean);
}

async function authenticateFirstPartyClient(env: Env, request: Request): Promise<string | null> {
  const credentials = parseBasicCredentials(request.headers.get("authorization"));
  if (!credentials) return null;
  if (!firstPartyRpClientIds(env).includes(credentials.clientId)) return null;

  const client = await env.DB.prepare(
    `SELECT "clientSecret" AS clientSecret, "disabled" AS disabled
     FROM "oauthClient" WHERE "clientId" = ? LIMIT 1`,
  )
    .bind(credentials.clientId)
    .first<{ clientSecret: string | null; disabled: number | null }>();
  if (!client?.clientSecret || client.disabled) return null;

  const presented = await sha256Base64Url(credentials.clientSecret);
  return timingSafeEqual(presented, client.clientSecret) ? credentials.clientId : null;
}

function parseBasicCredentials(
  header: string | null,
): { clientId: string; clientSecret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length).trim());
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) return null;
  try {
    // RFC 6749 §2.3.1: both parts are form-urlencoded before Basic encoding.
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, " ")),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, " ")),
    };
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
