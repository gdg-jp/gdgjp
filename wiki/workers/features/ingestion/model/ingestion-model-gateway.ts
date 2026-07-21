import type { FilePart, ModelMessage, TextPart } from "ai";
import { generateText, stepCountIs } from "ai";
import type { z } from "zod";
import {
  type WikiGenerationModelEnvironment,
  createWikiLanguageModelFromEnv,
  createWikiModelFromEnv,
  getWikiModelId,
} from "../../../../app/features/ai/model/index.server";
import type {
  ChangesetOperation,
  ClarificationResult,
  IngestionInputs,
  OperationPlan,
} from "../../../../shared/ingestion/domain";
import {
  ClarificationResultSchema,
  CreateOperationSchema,
  OperationPlanSchema,
} from "../../../../shared/ingestion/domain";
import {
  type GenerationObservability,
  type GenerationTraceContext,
  type ModelCallTraceContext,
  createAiGatewayTelemetryHeaders,
  createModelCallTraceContext,
} from "../observability";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import type { WorkspaceManifest } from "../tools/workspace/contracts";
import { createWorkspaceToolCatalog } from "../tools/workspace/tool-catalog";
import type { MountedWorkspace } from "../tools/workspace/workspace";
import { GENERATION_EXPLORATION_STEP_LIMIT } from "./agent-loop";
import type { ModelProgram } from "./event-sink";
import { type OperationPlanCandidate, OperationPlanOutputSchema } from "./operation-plan-output";
import { type ResolvedEvidence, createPageDraftProgram } from "./page-draft-program";
import {
  CLARIFICATION_PROMPT,
  GENERATION_PROMPT_VERSION,
  PLANNING_PROMPT,
  WORKSPACE_INSTRUCTIONS,
} from "./prompts";
import {
  type StructuredOutputAttemptResult,
  type StructuredOutputTelemetry,
  generateValidatedObject,
} from "./structured-output";

/** The Model layer owns LLM execution but never creates a database client. */
export interface GenerationModelContext {
  /** Trusted user-authored text is always direct model context, never a workspace node. */
  userInput: string;
  clarificationAnswers?: string;
  inputs: IngestionInputs;
  workspace: MountedWorkspace;
  loadAttachments: () => Promise<FilePart[]>;
  /** Resolves an access-checked `/wiki/...` slug hierarchy to durable D1 identity. */
  resolveExistingWikiPage: (
    absolutePath: string,
  ) => Promise<{ pageId: string; pageTitle: string } | null>;
  /** Resolves content for an update after orchestration has authorized it. */
  loadExistingPageContent: (pageId: string) => Promise<string | null>;
}

export interface ModelGateway {
  clarify(context: GenerationModelContext): Promise<{
    result: ClarificationResult;
    manifest: WorkspaceManifest;
  }>;
  plan(
    context: GenerationModelContext,
  ): Promise<{ plan: OperationPlan; manifest: WorkspaceManifest }>;
  generateOperations(
    context: GenerationModelContext,
    plan: OperationPlan,
    manifest: WorkspaceManifest,
  ): Promise<ChangesetOperation[]>;
  generationManifest(
    workspace: WorkspaceManifest,
    sourceHashes?: readonly string[],
  ): Record<string, unknown>;
}

async function emitSafely(
  sink: ExecutionEventSink | undefined,
  event: Parameters<ExecutionEventSink["emit"]>[0],
): Promise<void> {
  try {
    await sink?.emit(event);
  } catch {
    // A disconnected realtime client must not fail durable work.
  }
}

async function loadEvidence(
  workspace: MountedWorkspace,
  manifest: WorkspaceManifest,
  requestedPaths: readonly string[],
): Promise<ResolvedEvidence[]> {
  const references = selectPlannedEvidenceReferences(manifest.references, requestedPaths);
  const chunks: ResolvedEvidence[] = [];
  for (const reference of references) {
    const read = await workspace.cat(reference.path, { cursor: reference.cursor });
    chunks.push({
      path: reference.path,
      content: read.data.content,
    });
  }
  return chunks;
}

type PlannerEvidenceReference = {
  path: string;
  cursor?: string;
};

/**
 * Filters untrusted model-selected evidence paths against the immutable trace
 * of files the planner actually read. This is pure so future workspace
 * adapters can supply the same contract without coupling this policy to D1.
 */
export function selectPlannedEvidenceReferences(
  manifestReferences: readonly PlannerEvidenceReference[],
  requestedPaths: readonly string[],
): Array<{ path: string; cursor?: string }> {
  // The plan may be model output, so it is not allowed to turn arbitrary
  // workspace paths into draft context. Only paths recorded by planner reads
  // are eligible. Unknown paths are deliberately ignored rather than read.
  const requested = new Set(requestedPaths);
  const unique = new Map<string, { path: string; cursor?: string }>();
  for (const reference of manifestReferences) {
    if (!requested.has(reference.path)) continue;
    unique.set(`${reference.path}:${reference.cursor ?? ""}`, {
      path: reference.path,
      ...(reference.cursor ? { cursor: reference.cursor } : {}),
    });
  }
  return [...unique.values()];
}

export async function resolvePlannedWikiReferences(
  candidate: OperationPlanCandidate,
  resolveExistingWikiPage: GenerationModelContext["resolveExistingWikiPage"],
  actualEvidence: readonly PlannerEvidenceReference[],
): Promise<OperationPlan> {
  const actualReadPaths = new Set(actualEvidence.map(({ path }) => path));
  const operations = await Promise.all(
    candidate.operations.map(async (operation) => {
      if (operation.type === "create") {
        let suggestedParentId: string | null = null;
        if (operation.suggestedParentPath) {
          if (
            !operation.suggestedParentPath.startsWith("/wiki/") ||
            !operation.evidencePaths.includes(operation.suggestedParentPath) ||
            !actualReadPaths.has(operation.suggestedParentPath)
          ) {
            throw new Error(`Planned parent path was not read: ${operation.suggestedParentPath}`);
          }
          const parent = await resolveExistingWikiPage(operation.suggestedParentPath);
          if (!parent) {
            throw new Error(
              `Planned parent page no longer exists: ${operation.suggestedParentPath}`,
            );
          }
          suggestedParentId = parent.pageId;
        }
        return CreateOperationSchema.parse({
          type: "create",
          tempId: crypto.randomUUID(),
          suggestedTitle: operation.suggestedTitle,
          suggestedParentId,
          pageType: operation.pageType,
          rationale: operation.rationale,
          evidencePaths: operation.evidencePaths,
        });
      }
      if (
        !operation.pagePath.startsWith("/wiki/") ||
        !operation.evidencePaths.includes(operation.pagePath) ||
        !actualReadPaths.has(operation.pagePath)
      ) {
        throw new Error(`Planned update path was not read: ${operation.pagePath}`);
      }
      const page = await resolveExistingWikiPage(operation.pagePath);
      if (!page) throw new Error(`Planned update page no longer exists: ${operation.pagePath}`);
      return {
        type: "update" as const,
        pageId: page.pageId,
        pageTitle: page.pageTitle,
        rationale: operation.rationale,
        evidencePaths: operation.evidencePaths,
      };
    }),
  );
  return OperationPlanSchema.parse({ planRationale: candidate.planRationale, operations });
}

export function createIngestionModelGateway(
  env: Env,
  eventSink?: ExecutionEventSink,
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
): ModelGateway {
  const modelEnv: WikiGenerationModelEnvironment = env;
  function gatewayHeaders(
    context: ModelCallTraceContext,
    program: ModelProgram,
  ): Record<string, string> | undefined {
    return createAiGatewayTelemetryHeaders(modelEnv, context, program);
  }

  function messageTextCharacters(messages: readonly ModelMessage[]): number {
    let total = 0;
    for (const message of messages) {
      if (typeof message.content === "string") {
        total += message.content.length;
        continue;
      }
      for (const part of message.content) {
        if (part.type === "text") total += part.text.length;
      }
    }
    return total;
  }

  function attachmentDescriptors(attachments: readonly FilePart[]) {
    return attachments.map((attachment) => {
      const data = attachment.data;
      const sizeBytes =
        typeof data === "string"
          ? Math.floor((data.length * 3) / 4)
          : data instanceof URL
            ? undefined
            : data instanceof ArrayBuffer
              ? data.byteLength
              : ArrayBuffer.isView(data)
                ? data.byteLength
                : undefined;
      return {
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        sizeBytes,
        source: data instanceof URL ? "url" : "inline",
      };
    });
  }

  function recordStructuredAttempt(
    context: ModelCallTraceContext,
    program: ModelProgram,
    inputChars: number,
    result: StructuredOutputAttemptResult,
    operationIndex?: number,
  ): void {
    if (!observability) return;
    observability.modelCall({
      context,
      model: result.responseModelId ?? getWikiModelId(env),
      promptVersion: GENERATION_PROMPT_VERSION,
      program,
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
          program,
          operationIndex,
          outcome: result.outcome,
          durationMs: result.durationMs,
          data: { stage: result.stage, error: result.error },
        },
        result.outcome === "error" ? "error" : "warn",
      );
    }
  }

  function structuredTelemetry(
    program: ModelProgram,
    inputChars: number,
    operationIndex?: number,
  ): StructuredOutputTelemetry | undefined {
    if (!trace) return undefined;
    const attempts = new Map<string, ModelCallTraceContext>();
    return {
      start(stage) {
        const context = createModelCallTraceContext(trace);
        attempts.set(context.modelCallId, context);
        observability?.event("model_call_started", context, {
          modelCallId: context.modelCallId,
          program,
          operationIndex,
          outcome: "processing",
          data: { stage },
        });
        return {
          modelCallId: context.modelCallId,
          headers: gatewayHeaders(context, program),
        };
      },
      finish(result) {
        const context = attempts.get(result.modelCallId);
        if (!context) return;
        recordStructuredAttempt(context, program, inputChars, result, operationIndex);
      },
    };
  }

  async function runAgentObject<T>(options: {
    program: Extract<ModelProgram, "clarify" | "plan">;
    workspace: MountedWorkspace;
    schema: z.ZodType<T>;
    name: string;
    system: string;
    prompt: string;
    userInput: string;
    clarificationAnswers?: string;
    attachments: FilePart[];
  }): Promise<T> {
    await emitSafely(eventSink, { type: "model_started", program: options.program });
    const directContext = [
      options.prompt,
      `ユーザー入力:\n${options.userInput}`,
      options.clarificationAnswers ? `確認回答:\n${options.clarificationAnswers}` : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: directContext } as TextPart, ...options.attachments],
      },
    ];
    if (observability && trace) {
      observability.event("model_input_prepared", trace, {
        program: options.program,
        outcome: "ready",
        data: {
          inputChars: directContext.length,
          attachments: attachmentDescriptors(options.attachments),
          schemaName: options.name,
        },
      });
    }
    const system = `${WORKSPACE_INSTRUCTIONS}\n\n${options.system}`;
    const model = createWikiLanguageModelFromEnv(env);
    const explorationContext = trace ? createModelCallTraceContext(trace) : undefined;
    const explorationStartedAt = Date.now();
    const stepStartedAt = new Map<number, number>();
    const stepInputChars = new Map<number, number>();
    const generateExploration = () =>
      generateText({
        model,
        system,
        messages,
        headers: explorationContext
          ? gatewayHeaders(explorationContext, options.program)
          : undefined,
        tools: createWorkspaceToolCatalog(
          options.workspace,
          eventSink,
          observability,
          trace,
          options.program,
        ),
        stopWhen: stepCountIs(GENERATION_EXPLORATION_STEP_LIMIT),
        prepareStep: async ({ stepNumber, messages: stepMessages }) => {
          stepStartedAt.set(stepNumber, Date.now());
          stepInputChars.set(stepNumber, messageTextCharacters(stepMessages));
          await emitSafely(eventSink, {
            type: "model_step",
            program: options.program,
            step: stepNumber,
            limit: GENERATION_EXPLORATION_STEP_LIMIT,
          });
          return {};
        },
        onStepFinish: (step) => {
          if (!explorationContext || !observability) return;
          observability.modelCall({
            context: explorationContext,
            model: step.response.modelId ?? getWikiModelId(env),
            promptVersion: GENERATION_PROMPT_VERSION,
            program: options.program,
            stage: `exploration:${step.stepNumber}`,
            outcome: step.finishReason === "error" ? "error" : "success",
            finishReason: step.finishReason,
            latencyMs: Date.now() - (stepStartedAt.get(step.stepNumber) ?? Date.now()),
            inputTokens: step.usage.inputTokens,
            outputTokens: step.usage.outputTokens,
            totalTokens: step.usage.totalTokens,
            inputChars: stepInputChars.get(step.stepNumber),
            outputChars: step.text.length,
            toolCount: step.toolCalls.length,
            repairCount: 0,
          });
        },
        temperature: 0.2,
        maxRetries: 0,
      });
    if (observability && explorationContext) {
      observability.event("model_call_started", explorationContext, {
        program: options.program,
        outcome: "started",
        data: {
          model: getWikiModelId(env),
          promptVersion: GENERATION_PROMPT_VERSION,
          stage: "exploration",
          inputChars: messageTextCharacters(messages),
        },
      });
    }
    let exploration: Awaited<ReturnType<typeof generateExploration>>;
    try {
      exploration = await (observability && trace
        ? observability.span(
            "generation.model",
            trace,
            {
              "generation.program": options.program,
              "generation.stage": "exploration",
              "generation.model": getWikiModelId(env),
            },
            generateExploration,
          )
        : generateExploration());
    } catch (error) {
      if (observability && explorationContext) {
        observability.modelCall({
          context: explorationContext,
          model: getWikiModelId(env),
          promptVersion: GENERATION_PROMPT_VERSION,
          program: options.program,
          stage: "exploration",
          outcome: "error",
          latencyMs: Date.now() - explorationStartedAt,
          inputChars: messageTextCharacters(messages),
          toolCount: 0,
          repairCount: 0,
        });
        observability.event("model_call_failed", explorationContext, {
          program: options.program,
          outcome: "error",
          durationMs: Date.now() - explorationStartedAt,
          error,
          data: { stage: "exploration" },
        });
      }
      throw error;
    }
    const structuredMessages = [...messages, ...exploration.response.messages];
    const generateStructured = () =>
      generateValidatedObject({
        model,
        schema: options.schema,
        schemaName: options.name,
        system: `${system}\n\n探索を終了し、ここまでの証拠から要求された構造化出力を必ず返してください。`,
        messages: structuredMessages,
        temperature: 0.2,
        maxRetries: 0,
        telemetry: structuredTelemetry(options.program, messageTextCharacters(structuredMessages)),
      });
    return observability && trace
      ? observability.span(
          "generation.model",
          trace,
          {
            "generation.program": options.program,
            "generation.stage": "structured",
            "generation.model": getWikiModelId(env),
          },
          generateStructured,
        )
      : generateStructured();
  }

  return {
    async clarify(context) {
      const result = await runAgentObject({
        program: "clarify",
        workspace: context.workspace,
        schema: ClarificationResultSchema,
        name: "ClarificationResult",
        system: CLARIFICATION_PROMPT,
        prompt: "一次資料を workspace から読み、確認質問の必要性を判定してください。",
        userInput: context.userInput,
        clarificationAnswers: context.clarificationAnswers,
        attachments: await context.loadAttachments(),
      });
      return { result, manifest: context.workspace.manifest() };
    },

    async plan(context) {
      const candidate = await runAgentObject({
        program: "plan",
        workspace: context.workspace,
        schema: OperationPlanOutputSchema,
        name: "OperationPlan",
        system: PLANNING_PROMPT,
        prompt: "一次資料を読み、必要な既存ページだけ探索して操作計画を作成してください。",
        userInput: context.userInput,
        clarificationAnswers: context.clarificationAnswers,
        attachments: await context.loadAttachments(),
      });
      const manifest = context.workspace.manifest();
      const plan = await resolvePlannedWikiReferences(
        candidate,
        context.resolveExistingWikiPage,
        manifest.references,
      );
      return { plan, manifest };
    },

    async generateOperations(context, plan, manifest) {
      const attachments = await context.loadAttachments();
      const model = createWikiModelFromEnv(env);
      let currentOperationIndex = 0;
      const pageDraftProgram = createPageDraftProgram(model, (input) =>
        structuredTelemetry(
          "draft",
          input.userInput.length +
            (input.clarificationAnswers?.length ?? 0) +
            input.evidence.reduce((total, item) => total + item.content.length, 0) +
            (input.existingTipTapJson?.length ?? 0),
          currentOperationIndex,
        ),
      );
      const operations: ChangesetOperation[] = [];

      for (const [index, operation] of plan.operations.entries()) {
        currentOperationIndex = index;
        await emitSafely(eventSink, {
          type: "operation_started",
          index,
          total: plan.operations.length,
          operationType: operation.type,
        });
        await emitSafely(eventSink, { type: "model_started", program: "draft" });
        const existingTipTapJson =
          operation.type === "update"
            ? await context.loadExistingPageContent(operation.pageId)
            : undefined;
        const evidence = await loadEvidence(context.workspace, manifest, operation.evidencePaths);
        if (observability && trace) {
          observability.event("model_input_prepared", trace, {
            program: "draft",
            operationIndex: index,
            outcome: "ready",
            data: {
              evidencePaths: operation.evidencePaths,
              evidenceChars: evidence.reduce((total, item) => total + item.content.length, 0),
              attachments: attachmentDescriptors(attachments),
              operationType: operation.type,
            },
          });
        }
        const generateDraft = () =>
          pageDraftProgram.generate({
            userInput: context.userInput,
            clarificationAnswers: context.clarificationAnswers,
            operation,
            evidence,
            attachments,
            existingTipTapJson: existingTipTapJson ?? undefined,
          });
        operations.push(
          await (observability && trace
            ? observability.span(
                "generation.model",
                trace,
                {
                  "generation.program": "draft",
                  "generation.stage": "structured",
                  "generation.model": getWikiModelId(env),
                  "generation.operation_index": index,
                },
                generateDraft,
              )
            : generateDraft()),
        );
        await emitSafely(eventSink, {
          type: "operation_completed",
          index,
          total: plan.operations.length,
        });
      }
      return operations;
    },

    generationManifest(workspace, sourceHashes) {
      return {
        model: getWikiModelId(env),
        promptVersion: GENERATION_PROMPT_VERSION,
        sourceHashes,
        evidence: workspace.references,
        toolOutcomes: workspace.tools,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
