import { type RpAuthInstance, initializeRpAuth } from "@gdgjp/gdg-lib";

let cached: { env: Env; instance: RpAuthInstance } | null = null;

export function getAuth(env: Env): RpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeRpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-sns",
    secret: env.RP_SESSION_SECRET,
    idp: {
      url: env.IDP_URL,
      clientId: env.IDP_CLIENT_ID,
      clientSecret: env.IDP_CLIENT_SECRET,
      fetch: (input, init) => env.ACCOUNTS.fetch(input, init),
    },
  });
  cached = { env, instance };
  return instance;
}
