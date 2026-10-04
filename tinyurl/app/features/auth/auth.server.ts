import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { instance: RpAuthInstance; env: Env } | null = null;

export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-tinyurl",
    secret: env.RP_SESSION_SECRET,
    idp: {
      url: env.IDP_URL,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
      // Keep Worker-to-Worker OIDC discovery, token, and UserInfo requests on
      // Cloudflare's internal network instead of looping through public HTTP.
      fetch: (input, init) => env.ACCOUNTS.fetch(input, init),
    },
  });
  cached = { instance, env };
  return instance;
}
