import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { instance: RpAuthInstance; env: Env } | null = null;

/**
 * The GDG Accounts relying-party auth instance for roster.
 *
 * Cookie prefix `gdgjp-roster` isolates roster's session/tx cookies from the
 * other apps on `*.gdgs.jp`. OIDC discovery/token/UserInfo calls go through
 * the `ACCOUNTS` service binding so Worker-to-Worker traffic stays on
 * Cloudflare's internal network.
 */
export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-roster",
    secret: env.RP_SESSION_SECRET,
    idp: {
      url: env.IDP_URL,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
      fetch: (input, init) => env.ACCOUNTS.fetch(input, init),
    },
  });
  cached = { instance, env };
  return instance;
}
