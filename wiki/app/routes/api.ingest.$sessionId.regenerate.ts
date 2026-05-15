import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import {
  type CreateOperation,
  type UpdateOperation,
  buildFeedbackSuffix,
  runPhase2Creator,
  runPhase2Patcher,
} from "~/lib/gemini.server";
import {
  type AiDraftJson,
  type ChangesetOperation,
  buildPageIndex,
} from "~/lib/ingestion-pipeline.server";
import { tiptapToMarkdown } from "~/lib/tiptap-convert";

type ResultDraft = Extract<AiDraftJson, { planRationale: string }>;

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const session = await db
    .select({
      userId: schema.ingestionSessions.userId,
      aiDraftJson: schema.ingestionSessions.aiDraftJson,
      inputsJson: schema.ingestionSessions.inputsJson,
      status: schema.ingestionSessions.status,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""))
    .get();

  if (!session) return new Response("Not found", { status: 404 });
  if (session.userId !== user.id) return new Response("Forbidden", { status: 403 });
  if (session.status !== "done") return new Response("Session not complete", { status: 409 });

  const RegenerateBodySchema = z.object({
    operationIndex: z.number().int().min(0),
    feedback: z.string().optional(),
  });
  const parseResult = RegenerateBodySchema.safeParse(await request.json());
  if (!parseResult.success) {
    return new Response(parseResult.error.message, { status: 400 });
  }
  const { operationIndex, feedback } = parseResult.data;

  const draft = JSON.parse(session.aiDraftJson ?? "null") as ResultDraft | null;
  if (!draft || !draft.operations) return new Response("No draft found", { status: 404 });

  const op = draft.operations[operationIndex];
  if (!op) return new Response("Operation not found", { status: 404 });

  const inputs = JSON.parse(session.inputsJson ?? "{}") as { texts?: string[] };
  const userText = (inputs.texts ?? []).join("\n\n");
  const feedbackSuffix = feedback ? buildFeedbackSuffix(feedback) : "";
  const userTextWithFeedback = userText + feedbackSuffix;

  // No file URIs for regeneration — Gemini File API URIs are ephemeral
  const fileUris: { uri: string; mimeType: string }[] = [];

  const currentDatetime = `${new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}（JST）`;

  let updatedOp: ChangesetOperation;

  try {
    if (op.type === "create" && op.draft) {
      const createOp: CreateOperation = {
        type: "create",
        tempId: op.tempId ?? "",
        suggestedTitle: { ja: op.draft.title.ja },
        suggestedParentId: op.draft.suggestedParentId ?? null,
        pageType: op.draft.suggestedPageType,
        rationale: op.rationale,
      };
      const pageIndex = await buildPageIndex(db, userTextWithFeedback);
      const newDraft = await runPhase2Creator(
        env.GEMINI_API_KEY,
        userTextWithFeedback,
        fileUris,
        createOp,
        pageIndex,
        [],
        currentDatetime,
      );
      updatedOp = { ...op, draft: newDraft };
    } else if (op.type === "update" && op.patch) {
      const updateOp: UpdateOperation = {
        type: "update",
        pageId: op.pageId ?? "",
        pageTitle: op.pageTitle ?? "",
        rationale: op.rationale,
      };
      const existingMarkdown = tiptapToMarkdown(op.existingTipTapJson ?? "");
      const newPatch = await runPhase2Patcher(
        env.GEMINI_API_KEY,
        userTextWithFeedback,
        fileUris,
        updateOp,
        existingMarkdown,
        currentDatetime,
      );
      updatedOp = { ...op, patch: newPatch };
    } else {
      return new Response("Cannot regenerate this operation type", { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Regeneration failed";
    return Response.json({ error: msg }, { status: 500 });
  }

  // Update the draft in DB
  const updatedOps = [...draft.operations];
  updatedOps[operationIndex] = updatedOp;
  const updatedDraft: ResultDraft = { ...draft, operations: updatedOps };

  await db
    .update(schema.ingestionSessions)
    .set({ aiDraftJson: JSON.stringify(updatedDraft) })
    .where(eq(schema.ingestionSessions.id, params.sessionId ?? ""));

  return Response.json({ operation: updatedOp });
}
