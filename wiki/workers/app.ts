import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createRequestHandler } from "react-router";
import * as schema from "../app/db/schema";
import { sendDueTaskReminders } from "../app/lib/discord-reminders.server";
import { isIngestionQueueMessage } from "../app/lib/ingestion-jobs.server";
import {
  isTranslationQueueBody,
  processIngestionMessage,
  processTranslationMessage,
} from "../app/lib/queue-processors.server";
import { CollabDurableObject } from "./collab-durable-object";

// The server build is a virtual module provided by @react-router/dev/vite at build time.
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // Route WebSocket collab connections to Durable Object
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/ws/collab/") &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const slug = url.pathname.split("/")[3];
      if (!slug) return new Response("Missing slug", { status: 400 });
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
        if (isIngestionQueueMessage(body)) {
          await processIngestionMessage(env, db, body);
          message.ack();
          continue;
        }

        if (isTranslationQueueBody(body)) {
          await processTranslationMessage(env, db, body);
          message.ack();
          continue;
        }

        console.warn("queue: invalid message body, dropping", message.id);
        message.ack();
      } catch (err) {
        console.error("queue: failed to process message", message.id, err);
        // Last-resort: try to mark the session as errored so the UI stops spinning
        if (isIngestionQueueMessage(body)) {
          try {
            await db
              .update(schema.ingestionSessions)
              .set({
                status: "error",
                errorMessage: "Ingestion failed due to an unexpected error.",
                phaseMessage: null,
                updatedAt: new Date(),
              })
              .where(eq(schema.ingestionSessions.id, body.sessionId));
          } catch {
            // nothing we can do; log above is sufficient
          }
        }
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

// Re-export Durable Object class so wrangler registers it
export { CollabDurableObject };
