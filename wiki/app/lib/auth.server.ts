// Wiki auth via the shared @gdgjp/gdg-lib RP factory (openid-client + signed
// session cookie). Replaces the old better-auth + Drizzle setup.

import { type AuthUser, type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

export type { AuthUser };

let cached: { instance: RpAuthInstance; env: Env } | null = null;

export function createAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-wiki",
    secret: env.BETTER_AUTH_SECRET,
    idp: {
      url: env.IDP_URL,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
    },
  });
  cached = { instance, env };
  return instance;
}

export type Auth = RpAuthInstance;
