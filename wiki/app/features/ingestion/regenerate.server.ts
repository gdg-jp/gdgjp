import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { createWikiModelFromEnv } from "~/features/ai/model/index.server";
import type { AiDraftJson, ChangesetOperation } from "./contracts";
import { PageDraftSchema, SectionPatchResponseSchema } from "./contracts";
import { loadIngestionAttachmentParts } from "./generation.server";
import { DRAFT_PROMPT } from "./prompts";
import { parseSessionInputsJson } from "./session.server";
import { loadNormalizedSource } from "./source-artifacts.server";

export async function regenerateDraftOperation(
  env: Env,
  sessionId: string,
  userId: string,
  params: { operationIndex: number; feedback?: string },
): Promise<ChangesetOperation> {
  const db = drizzle(env.DB, { schema });
  const session = await db
    .select({
      userId: schema.ingestionSessions.userId,
      status: schema.ingestionSessions.status,
      aiDraftJson: schema.ingestionSessions.aiDraftJson,
      inputsJson: schema.ingestionSessions.inputsJson,
      contextManifestJson: schema.ingestionSessions.contextManifestJson,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, sessionId))
    .get();
  if (!session || session.userId !== userId || session.status !== "done" || !session.aiDraftJson)
    throw new Error("Draft is not available");
  const draft = JSON.parse(session.aiDraftJson) as AiDraftJson;
  if (draft.phase && draft.phase !== "result") throw new Error("Draft is not available");
  const operation = draft.operations[params.operationIndex];
  if (!operation) throw new Error("Operation not found");
  let artifactKey: string | undefined;
  try {
    artifactKey = (
      JSON.parse(session.contextManifestJson ?? "{}") as { sourceArtifact?: { key?: string } }
    ).sourceArtifact?.key;
  } catch {
    artifactKey = undefined;
  }
  const inputs = parseSessionInputsJson(session.inputsJson);
  const evidence = (await loadNormalizedSource(env, artifactKey)) ?? inputs.texts.join("\n\n");
  const attachments = await loadIngestionAttachmentParts(env, inputs);
  const model = createWikiModelFromEnv(env);
  const prompt = `元の操作:\n${JSON.stringify(operation)}\nユーザーの再生成指示:\n${params.feedback ?? "品質を改善してください"}\n\n一次資料:\n${evidence.slice(0, 120_000)}`;
  const replacement: ChangesetOperation =
    operation.type === "create"
      ? {
          ...operation,
          draft: await model.generateObject({
            schema: PageDraftSchema,
            schemaName: "PageDraft",
            system: DRAFT_PROMPT,
            messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...attachments] }],
            temperature: 0.2,
          }),
        }
      : {
          ...operation,
          patch: await model.generateObject({
            schema: SectionPatchResponseSchema,
            schemaName: "SectionPatchResponse",
            system: DRAFT_PROMPT,
            messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...attachments] }],
            temperature: 0.2,
          }),
        };
  draft.operations[params.operationIndex] = replacement;
  draft.sensitiveItems = draft.operations.flatMap(
    (item) => item.draft?.sensitiveItems ?? item.patch?.sensitiveItems ?? [],
  );
  await db
    .update(schema.ingestionSessions)
    .set({ aiDraftJson: JSON.stringify(draft), updatedAt: new Date() })
    .where(eq(schema.ingestionSessions.id, sessionId));
  return replacement;
}
