import type { FilePart } from "ai";
import type { z } from "zod";
import { createWikiModelFromEnv } from "../../../../app/features/ai/model/index.server";
import type { ChangesetOperation } from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { PageDraftOutputSchema, SectionPatchResponseOutputSchema } from "./page-content-output";
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
  userInput: string,
  evidence: string,
  attachments: FilePart[],
  feedback?: string,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<ChangesetOperation> {
  await events.emit({ type: "model_started", program: "regenerate" });
  const prompt = `ユーザー入力:\n${userInput}\n\n元の操作:\n${JSON.stringify(operation)}\nユーザーの再生成指示:\n${feedback ?? "品質を改善してください"}\n\n選択済みの一次資料:\n${evidence.slice(0, 120_000)}`;
  if (operation.type === "create") {
    return {
      ...operation,
      draft: await generateReplacement(
        env,
        PageDraftOutputSchema,
        "PageDraft",
        prompt,
        attachments,
      ),
    };
  }
  return {
    ...operation,
    patch: await generateReplacement(
      env,
      SectionPatchResponseOutputSchema,
      "SectionPatchResponse",
      prompt,
      attachments,
    ),
  };
}
