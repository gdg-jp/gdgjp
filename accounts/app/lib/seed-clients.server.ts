import { CHAPTERS_SCOPE } from "./auth.server";

interface ClientSpec {
  clientId: string;
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
}

export async function seedClients(env: Env): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  const now = new Date().toISOString();

  for (const spec of collectSpecs(env)) {
    if (!spec.clientSecret || spec.redirectUris.length === 0) {
      skipped.push(spec.clientId);
      continue;
    }
    const postLogoutRedirectUris = spec.redirectUris.map((uri) =>
      new URL("/signin", new URL(uri).origin).toString(),
    );
    await env.DB.prepare(
      `INSERT INTO oauthClient (
         id, clientId, clientSecret, disabled, skipConsent, enableEndSession,
         subjectType, scopes, createdAt, updatedAt, name, redirectUris,
         postLogoutRedirectUris, tokenEndpointAuthMethod, grantTypes,
         responseTypes, public, type, requirePKCE
       ) VALUES (?, ?, ?, 0, 1, 1, 'public', ?, ?, ?, ?, ?, ?,
                 'client_secret_basic', ?, ?, 0, 'web', 1)
       ON CONFLICT(clientId) DO UPDATE SET
         clientSecret = excluded.clientSecret,
         disabled = 0,
         skipConsent = 1,
         enableEndSession = 1,
         scopes = excluded.scopes,
         updatedAt = excluded.updatedAt,
         name = excluded.name,
         redirectUris = excluded.redirectUris,
         postLogoutRedirectUris = excluded.postLogoutRedirectUris,
         tokenEndpointAuthMethod = excluded.tokenEndpointAuthMethod,
         grantTypes = excluded.grantTypes,
         responseTypes = excluded.responseTypes,
         requirePKCE = 1`,
    )
      .bind(
        crypto.randomUUID(),
        spec.clientId,
        await sha256Base64Url(spec.clientSecret),
        JSON.stringify(["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE]),
        now,
        now,
        spec.clientName,
        JSON.stringify(spec.redirectUris),
        JSON.stringify(postLogoutRedirectUris),
        JSON.stringify(["authorization_code", "refresh_token"]),
        JSON.stringify(["code"]),
      )
      .run();
    written.push(spec.clientId);
  }
  return { written, skipped };
}

function collectSpecs(env: Env): ClientSpec[] {
  const apps = [
    [
      "GDG Japan Links",
      env.TINYURL_CLIENT_ID,
      env.TINYURL_CLIENT_SECRET,
      env.TINYURL_REDIRECT_URLS,
    ],
    ["GDG Japan Wiki", env.WIKI_CLIENT_ID, env.WIKI_CLIENT_SECRET, env.WIKI_REDIRECT_URLS],
    ["GDG Japan Image", env.IMG_CLIENT_ID, env.IMG_CLIENT_SECRET, env.IMG_REDIRECT_URLS],
    [
      "GDG Japan Scheduler",
      env.SCHEDULER_CLIENT_ID,
      env.SCHEDULER_CLIENT_SECRET,
      env.SCHEDULER_REDIRECT_URLS,
    ],
  ] as const;
  return apps.flatMap(([clientName, clientId, clientSecret, redirectUrls]) =>
    clientId
      ? [
          {
            clientId,
            clientSecret: clientSecret ?? "",
            clientName,
            redirectUris: (redirectUrls ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        ]
      : [],
  );
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
