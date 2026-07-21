import { getAgentByName } from "agents";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import type { IngestionResumePostClarificationDraft } from "~/lib/ingestion-jobs.server";
import type { AiDraftJson } from "~/lib/ingestion-pipeline.server";
import type { WikiIngestionAgent } from "../../workers/ingestion-agent";

const ClarifyBodySchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      answer: z.string(),
    }),
  ),
});

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const session = await db
    .select()
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) throw new Response("Not found", { status: 404 });
  if (session.userId !== user.id) throw new Response("Forbidden", { status: 403 });
  if (session.status !== "awaiting_clarification") {
    return new Response("Session is not awaiting clarification", { status: 409 });
  }

  const parseResult = ClarifyBodySchema.safeParse(await request.json());
  if (!parseResult.success) {
    return new Response(parseResult.error.message, { status: 400 });
  }
  const { answers } = parseResult.data;

  // Parse stored clarification data to recover file URIs
  let storedDraft: AiDraftJson | null = null;
  try {
    storedDraft = session.aiDraftJson ? (JSON.parse(session.aiDraftJson) as AiDraftJson) : null;
  } catch {
    return new Response("Failed to parse stored draft", { status: 500 });
  }

  if (!storedDraft || storedDraft.phase !== "clarification") {
    return new Response("Invalid stored draft state", { status: 500 });
  }

  const fileUris = storedDraft.fileUris;
  const googleDocText = storedDraft.googleDocText ?? "";

  // Build clarification answers string
  const clarificationAnswers = [
    "## 補足情報（ユーザーへの確認結果）",
    ...answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`),
  ].join("\n");

  const resumeDraft: IngestionResumePostClarificationDraft = {
    phase: "resume_post_clarification",
    fileUris,
    clarificationAnswers,
    googleDocText: googleDocText || undefined,
    sourceArtifactKey: storedDraft.sourceArtifactKey,
    sources: storedDraft.sources,
  };

  // Transition status back to processing
  await db
    .update(schema.ingestionSessions)
    .set({
      status: "processing",
      aiDraftJson: JSON.stringify(resumeDraft),
      phaseMessage: "parsing",
      updatedAt: new Date(),
    })
    .where(eq(schema.ingestionSessions.id, session.id));

  try {
    const agent = await getAgentByName<Env, WikiIngestionAgent>(env.INGESTION_AGENT, session.id);
    await agent.resumeIngestion(session.id, user.id, "clarification");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "awaiting_clarification",
        aiDraftJson: session.aiDraftJson,
        phaseMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, session.id));
    throw new Response(`Failed to enqueue ingestion job: ${message}`, { status: 500 });
  }

  return Response.json({ ok: true });
}
