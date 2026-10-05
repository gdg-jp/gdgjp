import type { FilePart } from "ai";
import type { z } from "zod";
import {
  type WikiGenerationModelEnvironment,
  createWikiModelFromEnv,
  getWikiModelId,
} from "../../../../app/features/ai/model/index.server";
import type { ChangesetOperation } from "../../../../shared/ingestion/domain";
import {
  type GenerationObservability,
  type GenerationTraceContext,
  createAiGatewayTelemetryHeaders,
  createModelCallTraceContext,
} from "../observability";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { PageDraftOutputSchema, SectionPatchResponseOutputSchema } from "./page-content-output";
import { DRAFT_PROMPT, GENERATION_PROMPT_VERSION } from "./prompts";
import type { StructuredOutputTelemetry } from "./structured-output";

function regenerationTelemetry(
  env: Env,
  observability: GenerationObservability | undefined,
  trace: GenerationTraceContext | undefined,
  operationIndex: number,
  inputChars: number,
): StructuredOutputTelemetry | undefined {
  if (!trace) return undefined;
  const modelEnv: WikiGenerationModelEnvironment = env;
  const attempts = new Map<string, ReturnType<typeof createModelCallTraceContext>>();
  return {
    start(stage) {
      const context = createModelCallTraceContext(trace);
      attempts.set(context.modelCallId, context);
      observability?.event("model_call_started", context, {
        modelCallId: context.modelCallId,
        program: "regenerate",
        operationIndex,
        outcome: "processing",
        data: { stage },
      });
      return {
        modelCallId: context.modelCallId,
        headers: createAiGatewayTelemetryHeaders(modelEnv, context, "regenerate"),
      };
    },
    finish(result) {
      const context = attempts.get(result.modelCallId);
      if (!context || !observability) return;
      observability.modelCall({
        context,
        model: result.responseModelId ?? getWikiModelId(env),
        promptVersion: GENERATION_PROMPT_VERSION,
        program: "regenerate",
        stage: result.stage,
        outcome: result.outcome,
        finishReason: result.finishReason,
        latencyMs: result.durationMs,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
        inputChars,
        outputChars: result.outputChars,
        toolCount: 0,
        repairCount: result.stage === "repair" ? 1 : 0,
      });
      if (result.outcome !== "success") {
        observability.event(
          "model_call_error_detail",
          context,
          {
            modelCallId: context.modelCallId,
            program: "regenerate",
            operationIndex,
            outcome: result.outcome,
            durationMs: result.durationMs,
            data: { stage: result.stage, error: result.error },
          },
          result.outcome === "error" ? "error" : "warn",
        );
      }
    },
  };
}

async function generateReplacement<T extends z.ZodType>(
  env: Env,
  schema: T,
  schemaName: string,
  prompt: string,
  attachments: FilePart[],
  operationIndex: number,
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
): Promise<z.infer<T>> {
  const generate = () =>
    createWikiModelFromEnv(env).generateObject({
      schema,
      schemaName,
      system: DRAFT_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...attachments] }],
      temperature: 0.2,
      maxRetries: 0,
      telemetry: regenerationTelemetry(env, observability, trace, operationIndex, prompt.length),
    });
  return observability && trace
    ? observability.span(
        "generation.model",
        trace,
        {
          "generation.program": "regenerate",
          "generation.stage": "structured",
          "generation.model": getWikiModelId(env),
          "generation.operation_index": operationIndex,
        },
        generate,
      )
    : generate();
}

export async function regenerateOperationWithModel(
  env: Env,
  operation: ChangesetOperation,
  userInput: string,
  evidence: string,
  attachments: FilePart[],
  feedback?: string,
  events: ExecutionEventSink = noopExecutionEventSink,
  operationIndex = 0,
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
): Promise<ChangesetOperation> {
  await events.emit({ type: "model_started", program: "regenerate" });
  const prompt = `ユーザー入力:\n${userInput}\n\n元の操作:\n${JSON.stringify(operation)}\nユーザーの再生成指示:\n${feedback ?? "品質を改善してください"}\n\n選択済みの一次資料:\n${evidence.slice(0, 120_000)}`;
  if (observability && trace) {
    observability.event("model_input_prepared", trace, {
      program: "regenerate",
      operationIndex,
      outcome: "ready",
      data: {
        inputChars: prompt.length,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          mediaType: attachment.mediaType,
          sizeBytes:
            typeof attachment.data === "string"
              ? Math.floor((attachment.data.length * 3) / 4)
              : attachment.data instanceof URL
                ? undefined
                : attachment.data instanceof ArrayBuffer
                  ? attachment.data.byteLength
                  : ArrayBuffer.isView(attachment.data)
                    ? attachment.data.byteLength
                    : undefined,
          source: attachment.data instanceof URL ? "url" : "inline",
        })),
      },
    });
  }
  if (operation.type === "create") {
    const generated = await generateReplacement(
      env,
      PageDraftOutputSchema,
      "PageDraft",
      prompt,
      attachments,
      operationIndex,
      observability,
      trace,
    );
    return {
      ...operation,
      draft: {
        ...generated,
        suggestedParentId: operation.draft?.suggestedParentId ?? null,
      },
    };
  }
  if (!operation.pageId) throw new Error("Update operation is missing its system page ID");
  const patch = await generateReplacement(
    env,
    SectionPatchResponseOutputSchema,
    "SectionPatchResponse",
    prompt,
    attachments,
    operationIndex,
    observability,
    trace,
  );
  return {
    ...operation,
    patch: { ...patch, pageId: operation.pageId },
  };
}
