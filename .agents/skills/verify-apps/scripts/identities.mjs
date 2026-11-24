import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applications, origin } from "./apps.mjs";

export const liveCheckin = {
  secret: "ci-live-checkin-auth-secret-0123456789abcdef",
  cookie: "authjs.session-token",
  users: {
    kwansai: {
      sub: "verify-kwansai",
      name: "Verify Kwansai",
      email: "kwansai@verify.local",
      chapters: [{ chapterId: 7, chapterSlug: "gdg-kwansai", role: "organizer" }],
    },
    outsider: {
      sub: "verify-outsider",
      name: "Verify Outsider",
      email: "outsider@verify.local",
      chapters: [{ chapterId: 1, chapterSlug: "dev-chapter", role: "member" }],
    },
  },
};

export function liveCheckinEnvironment(accounts) {
  return {
    AUTH_SECRET: liveCheckin.secret,
    AUTH_URL: origin("live-checkin"),
    AUTH_TRUST_HOST: "true",
    GDG_CLIENT_ID: "live-checkin",
    GDG_CLIENT_SECRET: "ci-idp-client-secret",
    ACCOUNTS_URL: accounts,
    CONNPASS_URL: "http://127.0.0.1:9",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function liveCheckinClientSql(now = new Date().toISOString()) {
  const secret = createHash("sha256").update("ci-idp-client-secret").digest("base64url");
  const redirect = `${origin("live-checkin")}/api/auth/callback/gdg-accounts`;
  const values = [
    "verify-live-checkin-client",
    "live-checkin",
    secret,
    JSON.stringify([
      "openid",
      "email",
      "profile",
      "offline_access",
      "https://gdgs.jp/scopes/chapters",
    ]),
    now,
    now,
    "GDG Live Check-in (verification)",
    JSON.stringify([redirect]),
    JSON.stringify([`${origin("live-checkin")}/`]),
    JSON.stringify(["authorization_code", "refresh_token"]),
    JSON.stringify(["code"]),
  ].map((value) => `'${value.replaceAll("'", "''")}'`);
  return `INSERT INTO oauthClient (id, clientId, clientSecret, disabled, skipConsent, enableEndSession, subjectType, scopes, createdAt, updatedAt, name, redirectUris, postLogoutRedirectUris, tokenEndpointAuthMethod, grantTypes, responseTypes, applicationType, public, type, requirePKCE) VALUES (${values.slice(0, 3).join(", ")}, 0, 1, 1, 'public', ${values.slice(3, 9).join(", ")}, 'client_secret_basic', ${values[9]}, ${values[10]}, 'web', 0, 'web', 1) ON CONFLICT(clientId) DO NOTHING;`;
}

function storageState(path, name, value, expires) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        cookies: [
          {
            name,
            value,
            domain: "localhost",
            path: "/",
            expires,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

export async function mintIdentities(snapshot, apps, accounts = "http://localhost:6173") {
  const result = { files: {}, cookies: {}, environment: {} };
  if (!apps.includes("live-checkin")) return result;
  const directory = join(snapshot.root, applications["live-checkin"].directory);
  const require = createRequire(join(directory, "package.json"));
  const { encode } = await import(pathToFileURL(require.resolve("next-auth/jwt")).href);
  const fixtures = join(snapshot.root, ".verification-fixtures");
  mkdirSync(fixtures, { recursive: true });
  const maxAge = 24 * 60 * 60;
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  result.files["live-checkin"] = {};
  result.cookies["live-checkin"] = {};
  for (const [identity, user] of Object.entries(liveCheckin.users)) {
    const value = await encode({
      token: {
        sub: user.sub,
        name: user.name,
        email: user.email,
        accessToken: `verify-${identity}-access-token`,
        chapters: user.chapters,
        isAdmin: false,
      },
      secret: liveCheckin.secret,
      salt: liveCheckin.cookie,
      maxAge,
    });
    const path = join(fixtures, `live-checkin-${identity}.json`);
    storageState(path, liveCheckin.cookie, value, expires);
    result.files["live-checkin"][identity] = path;
    result.cookies["live-checkin"][identity] = `${liveCheckin.cookie}=${value}`;
  }
  result.environment["live-checkin"] = liveCheckinEnvironment(accounts);
  return result;
}
