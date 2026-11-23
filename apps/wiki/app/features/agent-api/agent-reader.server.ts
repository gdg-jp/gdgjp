import type { BearerClient } from "@gdgjp/gdg-lib";
import { getBearerIdentity } from "@gdgjp/gdg-lib";
import { and, eq, gt, isNull } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { ExtraPrincipal, SpaceIdentity } from "~/features/spaces/access.server";
import type { getDb } from "~/lib/db.server";

type Db = ReturnType<typeof getDb>;

export type ReaderIdentity = SpaceIdentity & {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    isAdmin: boolean;
  } | null;
  chapters: Array<{ chapterId: string | number; role: string }>;
};

export type AgentReader = {
  identity: ReaderIdentity;
  extraPrincipals: ExtraPrincipal[];
  via: "user" | "principal" | "anonymous" | "job" | "eval";
  jobId?: string;
  client?: BearerClient | null;
};

export const EVAL_SPACE_PREFIX = "e2e-";

export function parseEvalHeader(value: string | null): ReaderIdentity | null | "invalid" {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "guest") return { user: null, chapters: [], claimsAvailable: false };
  const match = /^(member|organizer):([A-Za-z0-9_-]{1,64})$/.exec(trimmed);
  if (!match?.[1] || !match[2]) return "invalid";
  return {
    user: {
      id: `eval:${match[1]}:${match[2]}`,
      email: `eval-${match[1]}@wiki.gdgs.jp`,
      name: `Eval ${match[1]}`,
      image: null,
      isAdmin: false,
    },
    chapters: [{ chapterId: match[2], role: match[1] }],
    claimsAvailable: true,
  };
}

export function readerMaySeeSpace(reader: AgentReader, spaceSlug: string): boolean {
  return reader.via !== "eval" || spaceSlug.startsWith(EVAL_SPACE_PREFIX);
}

export const JOB_TOKEN_PREFIX = "jt_";
export const JOB_TOKEN_TTL_SECONDS = 10 * 60;

function bearer(request: Request): string {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function serviceSecret(env: Env): string | null {
  const secret = (env as unknown as { AGENT_SERVICE_TOKEN?: string }).AGENT_SERVICE_TOKEN;
  return secret && secret.length >= 32 ? secret : null;
}

export function isAgentService(request: Request, env: Env): boolean {
  const secret = serviceSecret(env);
  if (!secret) return false;
  const header = request.headers.get("x-agent-service-token") ?? bearer(request);
  return timingSafeEqual(header, secret);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const ANONYMOUS: ReaderIdentity = { user: null, chapters: [], claimsAvailable: false };

export function parsePrincipalHeader(value: string | null): ExtraPrincipal | null | "invalid" {
  if (!value) return null;
  const match = /^(discord_guild|chat_space):(.+)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return "invalid";
  const type = match[1] as ExtraPrincipal["type"];
  const id = match[2];
  if (type === "discord_guild" && !/^\d{5,25}$/.test(id)) return "invalid";
  if (type === "chat_space" && !/^spaces\/[A-Za-z0-9_-]+$/.test(id)) return "invalid";
  return { type, id };
}

export async function resolveAgentReader(
  request: Request,
  env: Env,
  db: Db,
  options: { allowJobToken?: boolean } = {},
): Promise<AgentReader | null> {
  const token = bearer(request);
  if (!token) return null;
  if (token.startsWith(JOB_TOKEN_PREFIX)) {
    if (!options.allowJobToken) return null;
    const row = await db
      .select({ jobId: schema.jobTokens.jobId, principal: schema.jobTokens.principal })
      .from(schema.jobTokens)
      .where(
        and(
          eq(schema.jobTokens.tokenHash, await sha256Hex(token)),
          gt(schema.jobTokens.expiresAt, new Date()),
          isNull(schema.jobTokens.revokedAt),
        ),
      )
      .get();
    if (!row) return null;
    const snapshot = JSON.parse(row.principal) as Pick<
      AgentReader,
      "identity" | "extraPrincipals"
    > & {
      evalOnly?: boolean;
    };
    return {
      identity: snapshot.identity,
      extraPrincipals: snapshot.extraPrincipals,
      via: snapshot.evalOnly ? "eval" : "job",
      jobId: row.jobId,
    };
  }
  const secret = serviceSecret(env);
  if (secret && timingSafeEqual(token, secret)) {
    const evalIdentity = parseEvalHeader(request.headers.get("x-agent-eval-as"));
    if (evalIdentity === "invalid") return null;
    if (evalIdentity) return { identity: evalIdentity, extraPrincipals: [], via: "eval" };
    const principal = parsePrincipalHeader(request.headers.get("x-agent-principal"));
    if (principal === "invalid") return null;
    return principal
      ? { identity: ANONYMOUS, extraPrincipals: [principal], via: "principal" }
      : { identity: ANONYMOUS, extraPrincipals: [], via: "anonymous" };
  }
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return null;
  return {
    identity: {
      user: {
        id: identity.user.id,
        email: identity.user.email ?? "",
        name: identity.user.name ?? "",
        image: identity.user.image ?? null,
        isAdmin: !!identity.user.isAdmin,
      },
      chapters: identity.chapters.map((c) => ({ chapterId: c.chapterId, role: c.role })),
      claimsAvailable: true,
    },
    extraPrincipals: [],
    via: "user",
    client: identity.client,
  };
}

export async function issueJobToken(
  db: Db,
  jobId: string,
  snapshot: Pick<AgentReader, "identity" | "extraPrincipals"> & { evalOnly?: boolean },
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `${JOB_TOKEN_PREFIX}${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")}`;
  await db.insert(schema.jobTokens).values({
    tokenHash: await sha256Hex(token),
    jobId,
    principal: JSON.stringify(snapshot),
    expiresAt: new Date(Date.now() + JOB_TOKEN_TTL_SECONDS * 1000),
  });
  return token;
}

export async function revokeJobTokens(db: Db, jobId: string): Promise<void> {
  await db
    .update(schema.jobTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.jobTokens.jobId, jobId), isNull(schema.jobTokens.revokedAt)));
}
