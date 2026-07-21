import type { FilePart } from "ai";
import type { z } from "zod";
import { createWikiModelFromEnv } from "../../../../app/features/ai/model/index.server";
import type { ChangesetOperation } from "../../../../shared/ingestion/domain";
import { PageDraftSchema, SectionPatchResponseSchema } from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { DRAFT_PROMPT } from "./prompts";

async function generateReplacement<T extends z.ZodType>(
  env: Env,
  schema: T,
  schemaName: string,
  prompt: string,
  attachments: FilePart[],
): Promise<z.infer<T>> {
  return createWikiModelFromEnv(env).generateObject({
    schema,
    schemaName,
    system: DRAFT_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...attachments] }],
    temperature: 0.2,
    maxRetries: 0,
  });
}

export async function regenerateOperationWithModel(
  env: Env,
  operation: ChangesetOperation,
  evidence: string,
  attachments: FilePart[],
  feedback?: string,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<ChangesetOperation> {
  await events.emit({ type: "model_started", program: "regenerate" });
  const prompt = `元の操作:\n${JSON.stringify(operation)}\nユーザーの再生成指示:\n${feedback ?? "品質を改善してください"}\n\n一次資料:\n${evidence.slice(0, 120_000)}`;
  if (operation.type === "create") {
    return {
      ...operation,
      draft: await generateReplacement(env, PageDraftSchema, "PageDraft", prompt, attachments),
    };
  }
  return {
    ...operation,
    patch: await generateReplacement(
      env,
      SectionPatchResponseSchema,
      "SectionPatchResponse",
      prompt,
      attachments,
    ),
  };
}
