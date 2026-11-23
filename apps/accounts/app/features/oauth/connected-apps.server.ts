import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { safeHttpUrl } from "~/features/oauth/oauth-consent.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";

export type ConnectedApp = {
  clientId: string;
  name: string;
  appUrl: string | null;
  ownerName: string | null;
  scopes: string[];
  grantedAt: string | null;
  lastTokenAt: string | null;
  disabled: boolean;
};

type ConnectedAppRow = {
  clientId: string;
  name: string | null;
  uri: string | null;
  ownerName: string | null;
  disabled: number | null;
  consentScopes: string | null;
  tokenScopes: string | null;
  grantedAt: string | null;
  lastTokenAt: string | null;
};

const LIVE_TOKEN = `"userId" = ?1 AND "clientId" = c."clientId"
      AND "revoked" IS NULL AND "expiresAt" > ?2`;

export async function listConnectedApps(
  db: D1Database,
  userId: string,
  now: Date = new Date(),
): Promise<ConnectedApp[]> {
  const { results } = await db
    .prepare(
      `SELECT c."clientId" AS clientId, c."name" AS name, c."uri" AS uri, c."disabled" AS disabled,
              owner."name" AS ownerName,
              (SELECT "scopes" FROM "oauthConsent"
               WHERE "userId" = ?1 AND "clientId" = c."clientId"
               ORDER BY "updatedAt" DESC LIMIT 1) AS consentScopes,
              (SELECT "scopes" FROM "oauthRefreshToken" WHERE ${LIVE_TOKEN}
               ORDER BY "createdAt" DESC LIMIT 1) AS tokenScopes,
              (SELECT MIN("createdAt") FROM "oauthConsent"
               WHERE "userId" = ?1 AND "clientId" = c."clientId") AS grantedAt,
              (SELECT MAX("createdAt") FROM (
                 SELECT "createdAt" FROM "oauthAccessToken"
                 WHERE "userId" = ?1 AND "clientId" = c."clientId"
                 UNION ALL
                 SELECT "createdAt" FROM "oauthRefreshToken"
                 WHERE "userId" = ?1 AND "clientId" = c."clientId"
               )) AS lastTokenAt
       FROM "oauthClient" c
       LEFT JOIN "user" owner ON owner."id" = c."userId"
       WHERE c."userId" IS NOT NULL
         AND (
           EXISTS (SELECT 1 FROM "oauthConsent"
                   WHERE "userId" = ?1 AND "clientId" = c."clientId")
           OR EXISTS (SELECT 1 FROM "oauthAccessToken" WHERE ${LIVE_TOKEN})
           OR EXISTS (SELECT 1 FROM "oauthRefreshToken" WHERE ${LIVE_TOKEN})
         )
       ORDER BY COALESCE(lastTokenAt, grantedAt) DESC, c."name", c."clientId"`,
    )
    .bind(userId, now.toISOString())
    .all<ConnectedAppRow>();
  return results.map(toConnectedApp);
}

export async function removeConnectedApp(
  db: D1Database,
  userId: string,
  clientId: string,
): Promise<void> {
  const ownedClient = `"userId" = ? AND "clientId" IN (
    SELECT "clientId" FROM "oauthClient" WHERE "clientId" = ? AND "userId" IS NOT NULL
  )`;
  await db.batch([
    db.prepare(`DELETE FROM "oauthConsent" WHERE ${ownedClient}`).bind(userId, clientId),
    db.prepare(`DELETE FROM "oauthAccessToken" WHERE ${ownedClient}`).bind(userId, clientId),
    db.prepare(`DELETE FROM "oauthRefreshToken" WHERE ${ownedClient}`).bind(userId, clientId),
  ]);
}

export async function loadConnectedApps(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const [t, locale, user] = await Promise.all([
    i18n.getFixedT(args.request),
    i18n.getLocale(args.request),
    requireSignedInUser(env, args.request),
  ]);
  return {
    title: t("meta.connectedApps"),
    locale,
    apps: await listConnectedApps(env.DB, user.id),
  };
}

export async function actOnConnectedApps(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireSignedInUser(env, args.request);
  const form = await args.request.formData();
  const clientId = String(form.get("clientId") ?? "");
  if (form.get("intent") !== "remove" || !clientId) return { ok: false as const };
  await removeConnectedApp(env.DB, user.id, clientId);
  return { ok: true as const, clientId };
}

function requireSignedInUser(env: Env, request: Request) {
  return requireUser(env, request).catch((error: unknown) => {
    if (error instanceof Response && error.status === 401) throw buildSignInRedirect(request);
    throw error;
  });
}

function toConnectedApp(row: ConnectedAppRow): ConnectedApp {
  const consentScopes = parseScopes(row.consentScopes);
  return {
    clientId: row.clientId,
    name: row.name?.trim() || row.clientId,
    appUrl: safeHttpUrl(row.uri),
    ownerName: row.ownerName?.trim() || null,
    scopes: consentScopes.length > 0 ? consentScopes : parseScopes(row.tokenScopes),
    grantedAt: row.grantedAt,
    lastTokenAt: row.lastTokenAt,
    disabled: row.disabled === 1,
  };
}

function parseScopes(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((scope) => typeof scope === "string") : [];
  } catch {
    return [];
  }
}
