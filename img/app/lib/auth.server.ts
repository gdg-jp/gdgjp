import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { instance: RpAuthInstance; env: Env } | null = null;

export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-img",
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
