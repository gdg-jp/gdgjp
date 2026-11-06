import * as schema from "~/db/schema";
import type { AuthUser } from "~/features/auth/utils.server";
import { enqueueSynthesize } from "~/features/jobs/enqueue.server";
import { enqueueTranslateNow } from "~/features/jobs/translate.server";
import { requireSpace } from "~/features/spaces/access.server";
import { getDb } from "~/lib/db.server";
import { pageInSpace } from "./page-space.server";

/**
 * Page intents that hand work to the agent runner: "ask the agent" (agent pages are
 * read-only for people) and "update the English version now". Both need the editor role.
 */
export async function handlePageAgentIntent(
  request: Request,
  env: Env,
  input: {
    intent: "translateNow" | "askAgent";
    spaceSlug: string | undefined;
    spaceId: string;
    leafSlug: string;
    form: FormData;
    user: AuthUser;
  },
) {
  const db = getDb(env);
  if (input.intent === "translateNow") {
    // "Update the English version now": a high-priority translate job for this page.
    await requireSpace(request, env, input.spaceSlug, "editor");
    const page = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(pageInSpace(input.spaceId, input.leafSlug))
      .get();
    if (!page) return Response.json({ error: "not_found" }, { status: 404 });
    const queued = await enqueueTranslateNow(db, page.id);
    return { ok: queued, translateQueued: queued };
  }

  if (input.intent === "askAgent") {
    // People change agent pages by asking: the request rides the space's next synthesize
    // job (hourly batching applies) and the runner reports back through a notification.
    const text = String(input.form.get("text") ?? "").trim();
    if (!text || text.length > 2000) {
      return Response.json({ error: "invalid_request_text" }, { status: 400 });
    }
    const page = await db
      .select({ id: schema.pages.id, slug: schema.pages.slug, origin: schema.pages.origin })
      .from(schema.pages)
      .where(pageInSpace(input.spaceId, input.leafSlug))
      .get();
    if (!page || page.origin !== "agent") {
      return Response.json({ error: "not_an_agent_page" }, { status: 400 });
    }
    // Asking needs the editor role in the space (viewers can read, not request changes).
    await requireSpace(request, env, input.spaceSlug, "editor");
    await enqueueSynthesize(db, {
      spaceId: input.spaceId,
      requests: [
        {
          pageSlug: page.slug,
          text,
          requestedBy: input.user.id,
          requestedByName: input.user.name,
          requestedAt: Math.floor(Date.now() / 1000),
        },
      ],
    });
    return { ok: true, asked: true };
  }

  return new Response("Unknown intent", { status: 400 });
}
