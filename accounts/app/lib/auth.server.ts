import { oauthProvider } from "@better-auth/oauth-provider";
import type { AuthUser } from "@gdgjp/gdg-lib";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { listActiveChaptersForUser } from "./db";

export const CHAPTERS_SCOPE = "https://gdgs.jp/scopes/chapters";
export const CHAPTERS_CLAIM = "https://gdgs.jp/claims/chapters";
export const IS_ADMIN_CLAIM = "https://gdgs.jp/claims/is_admin";
export const OAUTH_STATE_STORAGE = "cookie" as const;

type AuthInstance = ReturnType<typeof buildAuth>;

let cached: { instance: AuthInstance; env: Env } | null = null;

export function getAuth(env: Env): AuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = buildAuth(env);
  cached = { instance, env };
  return instance;
}

export async function getSessionUser(env: Env, request: Request): Promise<AuthUser | null> {
  const session = await getAuth(env).api.getSession({ headers: request.headers });
  if (!session) return null;
  const user = session.user as typeof session.user & { isAdmin?: boolean | null };
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    isAdmin: user.isAdmin === true,
  };
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser> {
  const user = await getSessionUser(env, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

function buildAuth(env: Env) {
  const trustedClientIds = [
    env.TINYURL_CLIENT_ID,
    env.WIKI_CLIENT_ID,
    env.IMG_CLIENT_ID,
    env.SCHEDULER_CLIENT_ID,
  ].filter(Boolean);

  return betterAuth({
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    advanced: {
      cookiePrefix: "gdgjp-accounts",
      database: { generateId: "uuid" },
    },
    user: {
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        isAdmin: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
          fieldName: "is_admin",
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      // Admin revocation deletes sessions in D1. Keep the database authoritative
      // so revoked users cannot continue with a cached, self-contained cookie.
      cookieCache: { enabled: false },
    },
    account: {
      // OAuth state is short-lived, encrypted, and bound to the browser. Keeping
      // it in the state cookie avoids a D1 write on every Google sign-in start;
      // user accounts and sessions remain database-backed.
      storeStateStrategy: OAUTH_STATE_STORAGE,
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
        redirectURI: `${trimTrailing(env.APP_URL)}/oauth/google/callback`,
      },
    },
    disabledPaths: ["/token"],
    plugins: [
      jwt({
        jwks: {
          keyPairConfig: { alg: "RS256", modulusLength: 2048 },
          rotationInterval: 60 * 60 * 24 * 30,
          gracePeriod: 60 * 60 * 24 * 30,
        },
        jwt: { issuer: trimTrailing(env.APP_URL) },
        disableSettingJwtHeader: true,
      }),
      oauthProvider({
        loginPage: "/signin",
        consentPage: "/oauth/consent",
        scopes: ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE],
        clientRegistrationDefaultScopes: ["openid"],
        clientRegistrationAllowedScopes: [
          "openid",
          "email",
          "profile",
          "offline_access",
          CHAPTERS_SCOPE,
        ],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: async ({ user }) => {
          if (!user) return false;
          const membership = await env.DB.prepare(
            "SELECT 1 AS ok FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1",
          )
            .bind(user.id)
            .first<{ ok: number }>();
          return membership?.ok === 1;
        },
        advertisedMetadata: {
          claims_supported: [CHAPTERS_CLAIM, IS_ADMIN_CLAIM],
        },
        cachedTrustedClients: new Set<string>(trustedClientIds),
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
        grantTypes: ["authorization_code", "refresh_token"],
        // Both root discovery routes are explicitly mounted through React Router.
        silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
        customUserInfoClaims: async ({ user, scopes }) =>
          scopes.includes(CHAPTERS_SCOPE) ? chapterClaims(env.DB, user.id, user) : {},
        customIdTokenClaims: async ({ user, scopes }) =>
          scopes.includes(CHAPTERS_SCOPE) ? chapterClaims(env.DB, user.id, user) : {},
      }),
    ],
  });
}

async function chapterClaims(
  db: D1Database,
  userId: string,
  user: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const chapters = await listActiveChaptersForUser(db, userId);
  return {
    [CHAPTERS_CLAIM]: chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterSlug: chapter.chapterSlug,
      role: chapter.role,
    })),
    [IS_ADMIN_CLAIM]: user.isAdmin === true,
  };
}

function trimTrailing(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
