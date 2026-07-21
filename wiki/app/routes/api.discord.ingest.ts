import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { createAccessContext } from "~/lib/agents/contracts";
import { buildIngestionQueueMessage } from "~/lib/ingestion-jobs.server";
import { sendOrRunIngestion } from "~/lib/queue-processors.server";

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.cloudflare;

  // Verify Authorization header
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !secureCompare(token, env.WIKI_DISCORD_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { discordUserId?: unknown; text?: unknown };
  try {
    body = (await request.json()) as { discordUserId?: unknown; text?: unknown };
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const { discordUserId, text } = body;
  if (typeof discordUserId !== "string" || typeof text !== "string") {
    return new Response("Bad Request", { status: 400 });
  }

  const db = drizzle(env.DB, { schema });

  // Lookup wiki user by Discord ID (linked via user_preferences)
  const wikiUser = await db
    .select({ id: schema.user.id, email: schema.user.email, isAdmin: schema.user.isAdmin })
    .from(schema.user)
    .innerJoin(schema.userPreferences, eq(schema.userPreferences.userId, schema.user.id))
    .where(eq(schema.userPreferences.discordId, discordUserId))
    .get();

  if (!wikiUser) {
    return Response.json({ error: "no_linked_account" });
  }

  const sessionId = nanoid();

  await db.insert(schema.ingestionSessions).values({
    id: sessionId,
    userId: wikiUser.id,
    status: "processing",
    inputsJson: JSON.stringify({ texts: [text], imageKeys: [], googleDocUrls: [] }),
    accessContextJson: JSON.stringify(
      createAccessContext({
        userId: wikiUser.id,
        email: wikiUser.email,
        isAdmin: wikiUser.isAdmin,
        chapterIds: [],
        claimsAvailable: false,
        source: "discord",
      }),
    ),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await sendOrRunIngestion(env, ctx, buildIngestionQueueMessage(sessionId, wikiUser.id));
  } catch (err) {
    console.error("discord/ingest: failed to enqueue ingestion job", { sessionId, err });
    await db
      .update(schema.ingestionSessions)
      .set({ status: "error", errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.ingestionSessions.id, sessionId));
    return Response.json({ error: "enqueue_failed" }, { status: 500 });
  }

  return Response.json({ sessionId });
}
