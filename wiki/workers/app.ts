import { routeAgentRequest } from "agents";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createRequestHandler } from "react-router";
import * as schema from "../app/db/schema";
import { createAuth } from "../app/lib/auth.server";
import { sendDueTaskReminders } from "../app/lib/discord-reminders.server";
import { getEffectivePagePermissions } from "../app/lib/page-access.server";
import {
  isTranslationQueueBody,
  processTranslationMessage,
} from "../app/lib/queue-processors.server";
import { CollabDurableObject } from "./collab-durable-object";
import { WikiGenerationAgent } from "./generation-agent";
import { WikiGenerationWorkflow } from "./generation-workflow";

// The server build is a virtual module provided by @react-router/dev/vite at build time.
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

async function authorizeGenerationAgentRequest(
  request: Request,
  env: Env,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = /^\/agents\/wiki-generation-agent\/([^/]+)/.exec(url.pathname);
  if (!match) return new Response("Not Found", { status: 404 });
  const sessionId = decodeURIComponent(match[1]);
  const user = await createAuth(env).getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const session = await env.DB.prepare("SELECT user_id FROM ingestion_sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ user_id: string }>();
  if (!session) return new Response("Not Found", { status: 404 });
  if (session.user_id !== user.id) return new Response("Forbidden", { status: 403 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Route WebSocket collab connections to Durable Object
    const url = new URL(request.url);
    if (url.pathname.startsWith("/agents/wiki-generation-agent/")) {
      const response = await routeAgentRequest(request, env, {
        onBeforeConnect: (agentRequest) => authorizeGenerationAgentRequest(agentRequest, env),
        onBeforeRequest: (agentRequest) => authorizeGenerationAgentRequest(agentRequest, env),
      });
      return response ?? new Response("Not Found", { status: 404 });
    }
    if (
      url.pathname.startsWith("/ws/collab/") &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const slug = url.pathname.split("/")[3];
      if (!slug) return new Response("Missing slug", { status: 400 });
      const auth = createAuth(env);
      const user = await auth.getSessionUser(request);
      if (!user) return new Response("Unauthorized", { status: 401 });
      const db = drizzle(env.DB, { schema });
      const page = await db
        .select({
          id: schema.pages.id,
          authorId: schema.pages.authorId,
          visibility: schema.pages.visibility,
          generalRole: schema.pages.generalRole,
        })
        .from(schema.pages)
        .where(eq(schema.pages.slug, slug))
        .get();
      if (!page) return new Response("Not Found", { status: 404 });
      let chapterIds: number[] = [];
      try {
        chapterIds = (await auth.getFreshClaims(request)).chapters.map(
          (chapter) => chapter.chapterId,
        );
      } catch {
        // Chapter-derived access fails closed; email/general grants still work.
      }
      const permissions = await getEffectivePagePermissions(db, page, user, chapterIds);
      if (!permissions.canEdit) return new Response("Forbidden", { status: 403 });
      const doId = env.COLLAB_DO.idFromName(slug);
      return env.COLLAB_DO.get(doId).fetch(request);
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },

  // Cron trigger: fires at 15:00 UTC (= 00:00 JST, i.e. the start of the next calendar day in JST).
  // sendDueTaskReminders queries tasks whose dueDate matches that JST date, so reminders go out
  // at the very beginning of the day the task is due.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("[scheduled] cron fired:", event.cron, "at", new Date().toISOString());
    ctx.waitUntil(
      sendDueTaskReminders(env).catch((err) => {
        console.error("[scheduled] sendDueTaskReminders failed:", err);
      }),
    );
  },

  // Queue consumer for background translation and ingestion jobs.
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log("[queue] handler invoked, queue:", batch.queue, "messages:", batch.messages.length);
    const db = drizzle(env.DB, { schema });

    for (const message of batch.messages) {
      console.log("[queue] processing message", message.id, "body:", JSON.stringify(message.body));
      const body = message.body;
      try {
        if (isTranslationQueueBody(body)) {
          await processTranslationMessage(env, db, body);
          message.ack();
          continue;
        }

        console.warn("queue: invalid message body, dropping", message.id);
        message.ack();
      } catch (err) {
        console.error("queue: failed to process message", message.id, err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

// Re-export Durable Object class so wrangler registers it
export { CollabDurableObject };
export { WikiGenerationAgent, WikiGenerationWorkflow };
