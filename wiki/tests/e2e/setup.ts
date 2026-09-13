import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_PERSISTENCE_ENV = "WIKI_E2E_PERSIST_TO";
export const E2E_SESSION_SECRET_ENV = "WIKI_E2E_SESSION_SECRET";
export const E2E_ISSUER_ENV = "WIKI_E2E_ISSUER";
export const DEFAULT_E2E_PERSISTENCE_PATH = ".wrangler/e2e-state";
export const E2E_STORAGE_STATE_RELATIVE_PATH = "tests/e2e/storage-state";
export const E2E_STORAGE_STATE_PATH = E2E_STORAGE_STATE_RELATIVE_PATH;
export const SESSION_COOKIE = "gdgjp-wiki-session";

export const USERS = {
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
} as const;

type E2EUser = (typeof USERS)[keyof typeof USERS];

function fail(phase: string, message: string): never {
  throw new Error(`[E2E setup:${phase}] ${message}`);
}

export function resolveE2EPersistencePath(
  value = DEFAULT_E2E_PERSISTENCE_PATH,
  cwd = process.cwd(),
): string {
  if (!value || value !== DEFAULT_E2E_PERSISTENCE_PATH) {
    fail("environment", `${E2E_PERSISTENCE_ENV} must be exactly ${DEFAULT_E2E_PERSISTENCE_PATH}`);
  }
  const path = resolve(cwd, value);
  const expected = resolve(cwd, DEFAULT_E2E_PERSISTENCE_PATH);
  if (path !== expected || !path.startsWith(`${resolve(cwd, ".wrangler")}/`)) {
    fail("environment", `${E2E_PERSISTENCE_ENV} must stay inside the Wiki .wrangler directory`);
  }
  return path;
}

export function readE2EAuthConfig(env: Record<string, string | undefined> = process.env): {
  secret: string;
  issuer: string;
} {
  const secret = env[E2E_SESSION_SECRET_ENV]?.trim();
  if (!secret) fail("environment", `${E2E_SESSION_SECRET_ENV} is required`);

  const rawIssuer = env[E2E_ISSUER_ENV]?.trim();
  if (!rawIssuer) fail("environment", `${E2E_ISSUER_ENV} is required`);
  let issuer: URL;
  try {
    issuer = new URL(rawIssuer);
  } catch {
    fail("environment", `${E2E_ISSUER_ENV} must be a localhost URL`);
  }
  if (
    issuer.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname) ||
    issuer.pathname !== "/" ||
    issuer.search ||
    issuer.hash
  ) {
    fail("environment", `${E2E_ISSUER_ENV} must be a localhost HTTP origin`);
  }
  return { secret, issuer: issuer.origin };
}

function b64url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signCookie(payload: unknown, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${signature}`;
}

export function buildSessionCookieValue(user: E2EUser, secret: string, issuer: string): string {
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  return signCookie(
    {
      version: 3,
      sessionId: `e2e-session-${user.id}`,
      userId: user.id,
      issuer,
      subject: user.id,
      email: user.email,
      name: user.name,
      picture: null,
      isAdmin: user.isAdmin === 1,
      expiresAt,
    },
    secret,
  );
}

function writeStorageStates(storageDirectory: string, secret: string, issuer: string): void {
  // Only this gitignored, test-owned directory is removed between retries.
  rmSync(storageDirectory, { recursive: true, force: true });
  mkdirSync(storageDirectory, { recursive: true });
  for (const user of Object.values(USERS)) {
    const state = {
      cookies: [
        {
          name: SESSION_COOKIE,
          value: buildSessionCookieValue(user, secret, issuer),
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [],
    };
    writeFileSync(join(storageDirectory, `${user.kind}.json`), JSON.stringify(state, null, 2));
  }
}

function runWrangler(args: string[], cwd: string, phase: string): string {
  try {
    return execFileSync("pnpm", ["exec", "wrangler", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    const printableArgs = args.filter((argument) => !argument.includes("SESSION_SECRET"));
    fail(phase, `command failed: pnpm exec wrangler ${printableArgs.join(" ")}`);
  }
}

function queryFixtureCounts(cwd: string, persistencePath: string): void {
  const persistenceArg = relative(cwd, persistencePath) || ".";
  const output = runWrangler(
    [
      "d1",
      "execute",
      "gdgjp-wiki-db",
      "--local",
      "--persist-to",
      persistenceArg,
      "--command",
      `SELECT COUNT(*) AS count FROM "user" WHERE id IN ('${USERS.admin.id}', '${USERS.author.id}', '${USERS.member.id}'); SELECT COUNT(*) AS count FROM pages WHERE id = '${TEST_PAGE.id}' AND slug = '${TEST_PAGE.slug}'; SELECT COUNT(*) AS count FROM page_access WHERE page_id = '${TEST_PAGE.id}';`,
      "--json",
    ],
    cwd,
    "invariant check",
  );
  let results: Array<{ results?: Array<{ count?: number | string }> }>;
  try {
    results = JSON.parse(output) as Array<{ results?: Array<{ count?: number | string }> }>;
  } catch {
    fail("invariant check", "Wrangler returned invalid JSON");
  }
  const counts = results.map((result) => Number(result.results?.[0]?.count));
  if (counts.length !== 3 || counts[0] !== 3 || counts[1] !== 1 || counts[2] !== 0) {
    fail("invariant check", "deterministic users, page, or initial ACL state is missing");
  }
}

export function prepareE2EState({
  cwd = process.cwd(),
  env = process.env,
}: { cwd?: string; env?: Record<string, string | undefined> } = {}): {
  persistencePath: string;
  storageStateDirectory: string;
} {
  const persistencePath = resolveE2EPersistencePath(env[E2E_PERSISTENCE_ENV], cwd);
  const { secret, issuer } = readE2EAuthConfig(env);
  const persistenceArg = relative(cwd, persistencePath) || ".";
  const seedPath = join(cwd, "tests/e2e/seed.sql");
  if (!existsSync(seedPath)) fail("seed", "tests/e2e/seed.sql is missing");

  runWrangler(
    ["d1", "migrations", "apply", "gdgjp-wiki-db", "--local", "--persist-to", persistenceArg],
    cwd,
    "migration",
  );
  runWrangler(
    [
      "d1",
      "execute",
      "gdgjp-wiki-db",
      "--local",
      "--persist-to",
      persistenceArg,
      "--file",
      "tests/e2e/seed.sql",
      "--yes",
    ],
    cwd,
    "seed",
  );
  queryFixtureCounts(cwd, persistencePath);

  const storageStateDirectory = join(cwd, E2E_STORAGE_STATE_RELATIVE_PATH);
  writeStorageStates(storageStateDirectory, secret, issuer);
  return { persistencePath, storageStateDirectory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    prepareE2EState();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
