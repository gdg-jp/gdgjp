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
    sessionToken: "e2e-admin-session-token",
    sessionId: "e2e-admin-session-id",
  },
  author: {
    id: "e2e-author-user-id",
    name: "E2E Author",
    email: "author@test.local",
    kind: "author" as const,
    isAdmin: 0,
    sessionToken: "e2e-author-session-token",
    sessionId: "e2e-author-session-id",
  },
  member: {
    id: "e2e-member-user-id",
    name: "E2E Member",
    email: "member@test.local",
    kind: "member" as const,
    isAdmin: 0,
    sessionToken: "e2e-member-session-token",
    sessionId: "e2e-member-session-id",
  },
} as const;

export const TEST_PAGE = {
  id: "e2e-test-page-id",
  slug: "e2e-test-page",
  authorId: USERS.author.id,
};

const D1_GLOB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const STORAGE_STATE_DIR = path.join(process.cwd(), "tests/e2e/storage-state");

// Matches advanced.cookiePrefix in wiki/app/lib/auth.server.ts.
const SESSION_COOKIE = "gdgjp-wiki.session_token";

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

function seedDb(dbPath: string): void {
  const db = new Database(dbPath);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 60 * 24; // 24h

  // Upsert users
  const upsertUser = db.prepare(`
    INSERT INTO user (id, name, email, emailVerified, isAdmin, preferredUiLanguage, preferredContentLanguage, createdAt, updatedAt)
    VALUES (?, ?, ?, 1, ?, 'ja', 'ja', ?, ?)
    ON CONFLICT(id) DO UPDATE SET isAdmin = excluded.isAdmin, updatedAt = excluded.updatedAt
  `);

  for (const u of Object.values(USERS)) {
    upsertUser.run(u.id, u.name, u.email, u.isAdmin, now, now);
  }

  // Upsert sessions
  const upsertSession = db.prepare(`
    INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET token = excluded.token, expiresAt = excluded.expiresAt, updatedAt = excluded.updatedAt
  `);

  for (const u of Object.values(USERS)) {
    upsertSession.run(u.sessionId, u.sessionToken, u.id, expiresAt, now, now);
  }

  // Upsert test page (authored by E2E Author)
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

function writeStorageState(user: (typeof USERS)[keyof typeof USERS]): void {
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });
  const state = {
    cookies: [
      {
        name: SESSION_COOKIE,
        value: user.sessionToken,
        domain: "localhost",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        httpOnly: true,
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
  console.log(`\n[E2E setup] Seeding D1 SQLite: ${dbPath}`);
  seedDb(dbPath);

  for (const u of Object.values(USERS)) {
    writeStorageState(u);
  }
  console.log(`[E2E setup] Storage state written to ${STORAGE_STATE_DIR}`);
}

export { USERS };
