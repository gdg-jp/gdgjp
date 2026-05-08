import { type IdpAuthInstance, type IdpClient, initializeIdpAuth } from "@gdgjp/gdg-lib";
import { listActiveChaptersForUser } from "./db";

let cached: { instance: IdpAuthInstance; env: Env } | null = null;

export function getAuth(env: Env): IdpAuthInstance {
  if (cached?.env === env) return cached.instance;
  const instance = initializeIdpAuth({
    db: env.DB,
    appUrl: env.APP_URL,
    cookiePrefix: "gdgjp-accounts",
    secret: env.BETTER_AUTH_SECRET,
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
    trustedClients: trustedClientsFromEnv(env),
    getAdditionalUserInfoClaim: async (user, scopes) => {
      if (!scopes.includes("profile")) return {};
      return getChapterClaim(env.DB, user.id);
    },
  });
  cached = { instance, env };
  return instance;
}

function trustedClientsFromEnv(env: Env): IdpClient[] {
  const clients: IdpClient[] = [];
  if (env.TINYURL_CLIENT_ID && env.TINYURL_CLIENT_SECRET) {
    clients.push({
      clientId: env.TINYURL_CLIENT_ID,
      clientSecret: env.TINYURL_CLIENT_SECRET,
      type: "web",
      name: "GDG Japan Links",
      redirectUrls: env.TINYURL_REDIRECT_URLS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      metadata: null,
      disabled: false,
      skipConsent: true,
    });
  }
  if (env.WIKI_CLIENT_ID && env.WIKI_CLIENT_SECRET) {
    clients.push({
      clientId: env.WIKI_CLIENT_ID,
      clientSecret: env.WIKI_CLIENT_SECRET,
      type: "web",
      name: "GDG Japan Wiki",
      redirectUrls: env.WIKI_REDIRECT_URLS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      metadata: null,
      disabled: false,
      skipConsent: true,
    });
  }
  if (env.IMG_CLIENT_ID && env.IMG_CLIENT_SECRET) {
    clients.push({
      clientId: env.IMG_CLIENT_ID,
      clientSecret: env.IMG_CLIENT_SECRET,
      type: "web",
      name: "GDG Japan Image",
      redirectUrls: env.IMG_REDIRECT_URLS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      metadata: null,
      disabled: false,
      skipConsent: true,
    });
  }
  return clients;
}

async function getChapterClaim(db: D1Database, userId: string) {
  const all = await listActiveChaptersForUser(db, userId);
  const primary = all[0] ?? null;
  return {
    chapterId: primary?.chapterId ?? null,
    chapterSlug: primary?.chapterSlug ?? null,
    chapterRole: primary?.role ?? null,
    chapters: all.map((c) => ({
      chapterId: c.chapterId,
      chapterSlug: c.chapterSlug,
      role: c.role,
    })),
  };
}
