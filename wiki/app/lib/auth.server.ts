import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, gt, isNull } from "drizzle-orm";
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
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "pending",
          // "admin" | "lead" | "member" | "viewer" | "pending"
        },
        chapterId: {
          type: "string",
          required: false,
        },
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
    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            // On first sign-in, check if there's a valid invitation for this email.
            const now = Math.floor(Date.now() / 1000);
            const drizzleDb = drizzle(env.DB, { schema });
            const invitation = await drizzleDb
              .select()
              .from(schema.invitations)
              .where(
                and(
                  eq(schema.invitations.email, userData.email),
                  gt(schema.invitations.expiresAt, now),
                  isNull(schema.invitations.acceptedAt),
                ),
              )
              .get();

            if (invitation) {
              // Accept the invitation and assign role + chapter
              await drizzleDb
                .update(schema.invitations)
                .set({ acceptedAt: now })
                .where(eq(schema.invitations.id, invitation.id));

              return {
                data: {
                  ...userData,
                  role: invitation.role,
                  chapterId: invitation.chapterId ?? undefined,
                },
              };
            }

            // No invitation found — set to pending (no access)
            return { data: { ...userData, role: "pending" } };
          },
        },
      },
    },
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
