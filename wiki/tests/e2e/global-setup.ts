import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// IDs are stable across runs so storageState files stay valid.
// `kind` distinguishes admin/author/member for the storage-state filename;
// `isAdmin` is the only role bit wiki tracks post-SSO (role/chapterId were
// dropped in migration 0019_remove_user_management.sql).
const USERS = {
  admin: {
    id: "e2e-admin-user-id",
    name: "E2E Admin",
    email: "admin@test.local",
    kind: "admin" as const,
    isAdmin: 1,
  },
  author: {
    id: "e2e-author-user-id",
    name: "E2E Author",
    email: "author@test.local",
    kind: "author" as const,
    isAdmin: 0,
  },
  member: {
    id: "e2e-member-user-id",
    name: "E2E Member",
    email: "member@test.local",
    kind: "member" as const,
    isAdmin: 0,
  },
} as const;

export const TEST_PAGE = {
  id: "e2e-test-page-id",
  slug: "e2e-test-page",
  authorId: USERS.author.id,
};

const D1_GLOB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const STORAGE_STATE_DIR = path.join(process.cwd(), "tests/e2e/storage-state");

// Must match the cookie name the openid-client RP factory writes:
// `${cookiePrefix}-session` where cookiePrefix = "gdgjp-wiki" (see
// wiki/app/lib/auth.server.ts).
const SESSION_COOKIE = "gdgjp-wiki-session";

function findD1Sqlite(): string {
  const dir = path.join(process.cwd(), D1_GLOB);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `D1 directory not found: ${dir}\nRun 'pnpm dev' once to initialise the local D1 database.`,
    );
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) {
    throw new Error(`No SQLite file found in ${dir}. Run 'pnpm dev' first.`);
  }

  // Pick the most recently modified file (wrangler only ever creates one)
  let best = files[0];
  let bestMtime = 0;
  for (const f of files) {
    const mtime = fs.statSync(path.join(dir, f)).mtimeMs;
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = f;
    }
  }
  return path.join(dir, best);
}

/**
 * Reads RP_SESSION_SECRET from .dev.vars. We need to sign cookies with the
 * exact same key the dev server uses to verify them.
 */
function readSessionSecret(): string {
  const devVars = path.join(process.cwd(), ".dev.vars");
  if (!fs.existsSync(devVars)) {
    throw new Error(
      `${devVars} not found — required for signing e2e session cookies.\nCopy .dev.vars.example to .dev.vars and set RP_SESSION_SECRET.`,
    );
  }
  const content = fs.readFileSync(devVars, "utf-8");
  const match = content.match(/^\s*RP_SESSION_SECRET\s*=\s*(.+?)\s*$/m);
  if (!match) {
    throw new Error("RP_SESSION_SECRET is not set in .dev.vars");
  }
  let secret = match[1].trim();
  if (
    (secret.startsWith('"') && secret.endsWith('"')) ||
    (secret.startsWith("'") && secret.endsWith("'"))
  ) {
    secret = secret.slice(1, -1);
  }
  if (!secret) throw new Error("RP_SESSION_SECRET is empty in .dev.vars");
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Replicates `signPayload` from gdg-lib/src/auth/cookie.ts (WebCrypto HMAC-
 * SHA256) using Node's crypto. Output format: `<b64url(JSON)>.<b64url(sig)>`.
 */
function signCookie(payload: unknown, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function seedDb(dbPath: string): void {
  const db = new Database(dbPath);

  const now = Math.floor(Date.now() / 1000);

  // Post-PR-2 user schema: snake_case, no emailVerified, no preferred* fields
  // (those live in user_preferences now, which e2e doesn't need to populate).
  const upsertUser = db.prepare(`
    INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      is_admin = excluded.is_admin,
      updated_at = excluded.updated_at
  `);

  for (const u of Object.values(USERS)) {
    upsertUser.run(u.id, u.email, u.name, u.isAdmin, now, now);
  }

  // Test page (authored by E2E Author) — pages schema unchanged in PR 2.
  const upsertPage = db.prepare(`
    INSERT INTO pages (id, title_ja, title_en, slug, content_ja, content_en, author_id, last_edited_by, visibility, status, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', 'published', 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET visibility = 'public', updated_at = excluded.updated_at
  `);

  upsertPage.run(
    TEST_PAGE.id,
    "E2E Test Page",
    "E2E Test Page",
    TEST_PAGE.slug,
    '{"type":"doc","content":[]}',
    '{"type":"doc","content":[]}',
    USERS.author.id,
    USERS.author.id,
    now,
    now,
  );

  db.close();
}

/**
 * Builds the SessionPayload struct the RP factory expects (see
 * `interface SessionPayload` in gdg-lib/src/auth/rp.ts), then HMAC-signs it
 * with the same RP_SESSION_SECRET the dev server uses. The access/refresh
 * tokens are dummy values — these e2e tests exercise UI behaviour against
 * the signed session, not the IdP, so getFreshClaims is never invoked.
 */
function buildSessionCookieValue(user: (typeof USERS)[keyof typeof USERS], secret: string): string {
  const farFuture = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    picture: null,
    isAdmin: user.isAdmin === 1,
    accessToken: "e2e-fake-access-token",
    refreshToken: null,
    accessTokenExpiresAt: farFuture,
    chapters: [],
    claimsCacheUntil: farFuture,
  };
  return signCookie(payload, secret);
}

function writeStorageState(user: (typeof USERS)[keyof typeof USERS], secret: string): void {
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });
  const state = {
    cookies: [
      {
        name: SESSION_COOKIE,
        value: buildSessionCookieValue(user, secret),
        domain: "localhost",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        httpOnly: true,
        // Dev server is HTTP (localhost); the RP factory matches this via
        // isLocalAppUrl(APP_URL) and emits non-Secure cookies in dev.
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  const filePath = path.join(STORAGE_STATE_DIR, `${user.kind}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export default async function globalSetup() {
  const dbPath = findD1Sqlite();
  const secret = readSessionSecret();
  console.log(`\n[E2E setup] Seeding D1 SQLite: ${dbPath}`);
  seedDb(dbPath);

  for (const u of Object.values(USERS)) {
    writeStorageState(u, secret);
  }
  console.log(`[E2E setup] Storage state written to ${STORAGE_STATE_DIR}`);
}

export { USERS };
