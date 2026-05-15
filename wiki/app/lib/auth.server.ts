import { SSO_PROVIDER_ID } from "@gdgjp/gdg-lib";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";

/**
 * Returns the singleton better-auth instance for this Worker isolate.
 *
 * better-auth's internal AsyncLocalStorage state is global (stored on globalThis),
 * so creating multiple instances per request causes a race condition on cold starts:
 * two concurrent requests both see the ALS as uninitialised, each creates a new
 * AsyncLocalStorage, and the second one overwrites the first.  The first request
 * then calls als_A.run() but getCurrentRequestState() looks up the now-overwritten
 * als_B, finds no store, and throws "No request state found."
 *
 * Cloudflare D1 bindings are valid for the entire isolate lifetime, so caching the
 * auth instance (and the drizzle client it wraps) across requests is safe.
 *
 * initAuth is extracted so ReturnType<typeof initAuth> preserves the specific
 * betterAuth generic inference (including additionalFields) for downstream types.
 */
function initAuth(env: Env) {
  const db = drizzle(env.DB);
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    advanced: { cookiePrefix: "gdgjp-wiki" },
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      additionalFields: {
        // Mirrored from the accounts IdP at sign-in via mapProfileToUser.
        // Better-auth only invokes mapProfileToUser on user create / account
        // link, so promotions take effect after the next sign-out + sign-in.
        isAdmin: { type: "boolean", required: false, input: false, defaultValue: false },
        preferredUiLanguage: {
          type: "string",
          defaultValue: "ja",
          // "ja" | "en"
        },
        preferredContentLanguage: {
          type: "string",
          defaultValue: "ja",
          // "ja" | "en"
        },
        discordId: {
          type: "string",
          required: false,
        },
      },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: SSO_PROVIDER_ID,
            clientId: env.IDP_CLIENT_ID,
            clientSecret: env.IDP_CLIENT_SECRET,
            discoveryUrl: `${env.IDP_URL}/api/auth/.well-known/openid-configuration`,
            scopes: ["openid", "email", "profile", "offline_access"],
            pkce: true,
            mapProfileToUser: (profile) => ({
              email: profile.email,
              name: profile.name ?? profile.email,
              image: profile.picture ?? null,
              emailVerified: profile.email_verified === true,
              isAdmin: profile.isAdmin === true,
            }),
          },
        ],
      }),
    ],
  });
}

let _auth: ReturnType<typeof initAuth> | null = null;

export function createAuth(env: Env): ReturnType<typeof initAuth> {
  if (_auth) return _auth;
  _auth = initAuth(env);
  return _auth;
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Awaited<ReturnType<Auth["api"]["getSession"]>>;
export type AuthUser = NonNullable<Session>["user"];
