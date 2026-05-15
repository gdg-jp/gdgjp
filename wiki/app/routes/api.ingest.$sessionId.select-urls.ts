import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import {
  type IngestionResumePostUrlSelectionDraft,
  buildIngestionQueueMessage,
} from "~/lib/ingestion-jobs.server";
import type { AiDraftJson } from "~/lib/ingestion-pipeline.server";
import { sendOrRunIngestion } from "~/lib/queue-processors.server";

const SelectUrlsBodySchema = z.object({
  selectedUrls: z.array(z.string().url()).max(5),
});

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const session = await db
    .select()
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) throw new Response("Not found", { status: 404 });
  if (session.userId !== user.id) throw new Response("Forbidden", { status: 403 });
  if (session.status !== "awaiting_url_selection") {
    return new Response("Session is not awaiting URL selection", { status: 409 });
  }

  let parseResult: ReturnType<typeof SelectUrlsBodySchema.safeParse>;
  try {
    const body = await request.json();
    parseResult = SelectUrlsBodySchema.safeParse(body);
  } catch (err) {
    return new Response(String((err as Error)?.message ?? "Invalid JSON"), { status: 400 });
  }
  if (!parseResult.success) {
    return new Response(parseResult.error.message, { status: 400 });
  }
  const { selectedUrls } = parseResult.data;

  // Recover stored URL selection data
  let storedDraft: AiDraftJson | null = null;
  try {
    storedDraft = session.aiDraftJson ? (JSON.parse(session.aiDraftJson) as AiDraftJson) : null;
  } catch {
    return new Response("Failed to parse stored draft", { status: 500 });
  }

  if (!storedDraft || storedDraft.phase !== "url_selection") {
    return new Response("Invalid stored draft state", { status: 500 });
  }

  // Validate that every selected URL was in the pipeline-extracted whitelist
  const whitelistedUrls = new Set(storedDraft.urls.map((u) => u.url));
  const invalidUrls = selectedUrls.filter((url) => !whitelistedUrls.has(url));
  if (invalidUrls.length > 0) {
    return new Response("Selected URLs are not in the allowed list", { status: 400 });
  }

  const fileUris = storedDraft.fileUris;
  const googleDocText = storedDraft.googleDocText ?? "";

  const resumeDraft: IngestionResumePostUrlSelectionDraft = {
    phase: "resume_post_url_selection",
    fileUris,
    selectedUrls,
    googleDocText: googleDocText || undefined,
  };

  // Transition status back to processing
  await db
    .update(schema.ingestionSessions)
    .set({
      status: "processing",
      aiDraftJson: JSON.stringify(resumeDraft),
      phaseMessage: "fetching_urls",
      updatedAt: new Date(),
    })
    .where(eq(schema.ingestionSessions.id, session.id));

  try {
    await sendOrRunIngestion(
      env,
      ctx,
      buildIngestionQueueMessage(session.id, user.id, "post_url_selection"),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "awaiting_url_selection",
        aiDraftJson: JSON.stringify(storedDraft),
        phaseMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, session.id));
    throw new Response(`Failed to enqueue ingestion job: ${message}`, { status: 500 });
  }

  return Response.json({ ok: true });
}
