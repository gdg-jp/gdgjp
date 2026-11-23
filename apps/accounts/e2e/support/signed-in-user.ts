import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACCOUNTS_DIRECTORY = resolve(import.meta.dirname, "../..");
const LOCAL_DATABASE = "gdgjp-accounts-db";

export type AccountsDatabase = { kind: "local" } | { kind: "remote"; name: string };

export type SignedInUser = {
  id: string;
  email: string;
  sessionToken: string;
  cookieName: string;
  cookieValue: string;
};

export function accountsDatabaseFromEnvironment(value = process.env.E2E_ACCOUNTS_D1) {
  if (!value || value === "local") return { kind: "local" } as const;
  if (value.startsWith("remote:") && value.length > "remote:".length)
    return { kind: "remote", name: value.slice("remote:".length) } as const;
  throw new Error(`E2E_ACCOUNTS_D1 must be "local" or "remote:<database name>", got ${value}`);
}

export function betterAuthSecret(): string {
  if (process.env.E2E_BETTER_AUTH_SECRET) return process.env.E2E_BETTER_AUTH_SECRET;
  const devVars = resolve(ACCOUNTS_DIRECTORY, ".dev.vars");
  if (existsSync(devVars)) {
    const line = readFileSync(devVars, "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("BETTER_AUTH_SECRET="));
    if (line) return line.slice("BETTER_AUTH_SECRET=".length).trim();
  }
  throw new Error("Set E2E_BETTER_AUTH_SECRET or BETTER_AUTH_SECRET in apps/accounts/.dev.vars");
}

export function sessionCookieName(accountsUrl: string): string {
  return new URL(accountsUrl).protocol === "https:"
    ? "__Secure-gdgjp-accounts.session_token"
    : "gdgjp-accounts.session_token";
}

export function signSessionToken(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function execute(database: AccountsDatabase, sql: string): void {
  const target =
    database.kind === "local"
      ? [LOCAL_DATABASE, "--local", "--persist-to", ".wrangler/state"]
      : [database.name, "--remote"];
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", ...target, "--command", sql], {
    cwd: ACCOUNTS_DIRECTORY,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}

export function createSignedInUser(
  database: AccountsDatabase,
  accountsUrl: string,
  secret: string,
): SignedInUser {
  const id = randomUUID();
  const email = `e2e-rp-sign-in-${id}@example.com`;
  const sessionToken = randomUUID().replaceAll("-", "");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const created = now.toISOString();
  execute(
    database,
    [
      `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES (${sqlString(id)}, 'E2E RP sign-in', ${sqlString(email)}, 1, ${sqlString(created)}, ${sqlString(created)});`,
      `INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (${sqlString(randomUUID())}, ${sqlString(expiresAt)}, ${sqlString(sessionToken)}, ${sqlString(created)}, ${sqlString(created)}, ${sqlString(id)});`,
    ].join(" "),
  );
  return {
    id,
    email,
    sessionToken,
    cookieName: sessionCookieName(accountsUrl),
    cookieValue: signSessionToken(sessionToken, secret),
  };
}

export function createSession(
  database: AccountsDatabase,
  accountsUrl: string,
  secret: string,
  user: Pick<SignedInUser, "id" | "email">,
): SignedInUser {
  const sessionToken = randomUUID().replaceAll("-", "");
  const now = new Date();
  const created = now.toISOString();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  execute(
    database,
    `INSERT INTO "session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (${sqlString(randomUUID())}, ${sqlString(expiresAt)}, ${sqlString(sessionToken)}, ${sqlString(created)}, ${sqlString(created)}, ${sqlString(user.id)});`,
  );
  return {
    ...user,
    sessionToken,
    cookieName: sessionCookieName(accountsUrl),
    cookieValue: signSessionToken(sessionToken, secret),
  };
}

export function queryRows<Row>(database: AccountsDatabase, sql: string): Row[] {
  const target =
    database.kind === "local"
      ? [LOCAL_DATABASE, "--local", "--persist-to", ".wrangler/state"]
      : [database.name, "--remote"];
  const output = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", ...target, "--json", "--command", sql],
    {
      cwd: ACCOUNTS_DIRECTORY,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  const [result] = JSON.parse(output.slice(output.indexOf("["))) as { results: Row[] }[];
  return result?.results ?? [];
}

export function findExistingMember(
  database: AccountsDatabase,
): Pick<SignedInUser, "id" | "email"> | null {
  const [member] = queryRows<{ id: string; email: string }>(
    database,
    `SELECT u."id", u."email" FROM "user" u
     JOIN "memberships" m ON m."user_id" = u."id" AND m."status" = 'active'
     WHERE u."email" NOT LIKE 'e2e-%' AND u."email_verified" = 1
     ORDER BY u."created_at" ASC LIMIT 1;`,
  );
  return member ?? null;
}

export function deleteSession(database: AccountsDatabase, user: SignedInUser): void {
  execute(database, `DELETE FROM "session" WHERE "token" = ${sqlString(user.sessionToken)};`);
}

export function deleteSignedInUser(database: AccountsDatabase, user: SignedInUser): void {
  execute(database, `DELETE FROM "user" WHERE "id" = ${sqlString(user.id)};`);
}
