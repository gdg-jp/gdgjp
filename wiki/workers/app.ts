import { routeAgentRequest } from "agents";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createRequestHandler } from "react-router";
import * as schema from "../app/db/schema";
import { createAuth } from "../app/features/auth/auth.server";
import { sendDueTaskReminders } from "../app/features/discord/reminders.server";
import { processGoogleDocumentImport } from "../app/features/google/documents/import.server";
import { getEffectivePagePermissions } from "../app/features/pages/access.server";
import { pageAclClearance } from "../app/features/pages/acl-spans.server";
import { backfillMarkdownContent } from "../app/features/pages/content-backfill.server";
import {
  enqueuePendingTranslations,
  isGoogleDocumentImportQueueBody,
  isSourceFetchQueueBody,
  isTranslationQueueBody,
  processTranslationMessage,
} from "../app/lib/queue-processors.server";
import { WikiGenerationAgent } from "./agents/wiki-generation-agent";
import { CollabDurableObject } from "./collab-durable-object";
import {
  SOURCE_REFRESH_CRON,
  TASK_REMINDER_CRON,
  enqueueDueSourceRefreshes,
  fetchSource,
} from "./features/sources/fetch-source";
import { SourceImportDurableObject } from "./source-import-durable-object";
import { WikiGenerationPhaseWorkflow } from "./workflows/wiki-generation-phase-workflow";

const TRANSLATION_CRON = "5 0 * * *";

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
          contentJa: schema.pages.contentJa,
          contentEn: schema.pages.contentEn,
        })
        .from(schema.pages)
        .where(eq(schema.pages.slug, slug))
        .get();
      if (!page) return new Response("Not Found", { status: 404 });
      let chapters: Array<{ chapterId: string; role: string }> = [];
      try {
        chapters = (await auth.getFreshClaims(request)).chapters.map((chapter) => ({
          chapterId: String(chapter.chapterId),
          role: chapter.role,
        }));
      } catch {
        // Chapter-derived access fails closed; email/general grants still work.
      }
      const permissions = await getEffectivePagePermissions(db, page, user, chapters);
      if (!permissions.canEdit) return new Response("Forbidden", { status: 403 });
      // Collab bypasses the React Router loader — reject when the caller cannot
      // read every ACL span so redacted content cannot be loaded into Yjs.
      const clearance = await pageAclClearance(
        db,
        [page.contentJa, page.contentEn],
        user,
        chapters,
      );
      if (!clearance) return new Response("Forbidden", { status: 403 });
      const doId = env.COLLAB_DO.idFromName(slug);
      return env.COLLAB_DO.get(doId).fetch(request);
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },

  // Cron triggers — discriminate by event.cron (must stay in sync with wrangler.toml).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("[scheduled] cron fired:", event.cron, "at", new Date().toISOString());

    if (event.cron === TASK_REMINDER_CRON) {
      ctx.waitUntil(
        sendDueTaskReminders(env).catch((err) => {
          console.error("[scheduled] sendDueTaskReminders failed:", err);
        }),
      );
      ctx.waitUntil(
        backfillMarkdownContent(env.DB).catch((err) => {
          console.error("[scheduled] markdown content backfill failed:", err);
        }),
      );
      return;
    }

    if (event.cron === SOURCE_REFRESH_CRON) {
      ctx.waitUntil(
        enqueueDueSourceRefreshes(env).catch((err) => {
          console.error("[scheduled] source refresh enqueue failed:", err);
        }),
      );
      return;
    }

    if (event.cron === TRANSLATION_CRON) {
      ctx.waitUntil(
        enqueuePendingTranslations(env).then((count) => {
          console.log("[translation] dispatched daily jobs:", count);
        }),
      );
      return;
    }

    console.warn("[scheduled] unrecognized cron expression:", event.cron);
  },

  // Queue consumer for background translation, Google Docs import, and source fetch.
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log("[queue] handler invoked, queue:", batch.queue, "messages:", batch.messages.length);
    const db = drizzle(env.DB, { schema });

    for (const message of batch.messages) {
      console.log("[queue] processing message", message.id, "body:", JSON.stringify(message.body));
      const body = message.body;
      try {
        if (isTranslationQueueBody(body)) {
          await processTranslationMessage(env, body);
          message.ack();
          continue;
        }

        if (isGoogleDocumentImportQueueBody(body)) {
          await processGoogleDocumentImport(env, body.jobId);
          message.ack();
          continue;
        }

        if (isSourceFetchQueueBody(body)) {
          // A source that can never succeed (no Drive token, deleted document) is acked
          // so it does not occupy the retry budget; only transient failures come back.
          const outcome = await fetchSource(env, body.sourceId);
          if (outcome.retryable) message.retry();
          else message.ack();
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
export { SourceImportDurableObject };
export { WikiGenerationAgent, WikiGenerationPhaseWorkflow };
