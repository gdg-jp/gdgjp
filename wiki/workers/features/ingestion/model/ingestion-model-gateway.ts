import type { FilePart, ModelMessage, TextPart } from "ai";
import { generateText, stepCountIs } from "ai";
import type { z } from "zod";
import {
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
  OperationPlanSchema,
} from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import type { WorkspaceManifest } from "../tools/workspace/contracts";
import { createWorkspaceToolCatalog } from "../tools/workspace/tool-catalog";
import type { MountedWorkspace } from "../tools/workspace/workspace";
import { GENERATION_EXPLORATION_STEP_LIMIT } from "./agent-loop";
import type { ModelProgram } from "./event-sink";
import { type ResolvedEvidence, createPageDraftProgram } from "./page-draft-program";
import {
  CLARIFICATION_PROMPT,
  GENERATION_PROMPT_VERSION,
  PLANNING_PROMPT,
  WORKSPACE_INSTRUCTIONS,
} from "./prompts";
import { generateValidatedObject } from "./structured-output";

/** The Model layer owns LLM execution but never creates a database client. */
export interface GenerationModelContext {
  /** Trusted user-authored text is always direct model context, never a workspace node. */
  userInput: string;
  clarificationAnswers?: string;
  inputs: IngestionInputs;
  workspace: MountedWorkspace;
  loadAttachments: () => Promise<FilePart[]>;
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

export function createIngestionModelGateway(
  env: Env,
  eventSink?: ExecutionEventSink,
): ModelGateway {
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
    const system = `${WORKSPACE_INSTRUCTIONS}\n\n${options.system}`;
    const model = createWikiLanguageModelFromEnv(env);
    const exploration = await generateText({
      model,
      system,
      messages,
      tools: createWorkspaceToolCatalog(options.workspace, eventSink),
      stopWhen: stepCountIs(GENERATION_EXPLORATION_STEP_LIMIT),
      prepareStep: async ({ stepNumber }) => {
        await emitSafely(eventSink, {
          type: "model_step",
          program: options.program,
          step: stepNumber,
          limit: GENERATION_EXPLORATION_STEP_LIMIT,
        });
        return {};
      },
      temperature: 0.2,
      maxRetries: 0,
    });
    return generateValidatedObject({
      model,
      schema: options.schema,
      schemaName: options.name,
      system: `${system}\n\n探索を終了し、ここまでの証拠から要求された構造化出力を必ず返してください。`,
      messages: [...messages, ...exploration.response.messages],
      temperature: 0.2,
      maxRetries: 0,
    });
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
      const plan = await runAgentObject({
        program: "plan",
        workspace: context.workspace,
        schema: OperationPlanSchema,
        name: "OperationPlan",
        system: PLANNING_PROMPT,
        prompt: "一次資料を読み、必要な既存ページだけ探索して操作計画を作成してください。",
        userInput: context.userInput,
        clarificationAnswers: context.clarificationAnswers,
        attachments: await context.loadAttachments(),
      });
      return { plan, manifest: context.workspace.manifest() };
    },

    async generateOperations(context, plan, manifest) {
      const attachments = await context.loadAttachments();
      const model = createWikiModelFromEnv(env);
      const pageDraftProgram = createPageDraftProgram(model);
      const operations: ChangesetOperation[] = [];

      for (const [index, operation] of plan.operations.entries()) {
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
        operations.push(
          await pageDraftProgram.generate({
            userInput: context.userInput,
            clarificationAnswers: context.clarificationAnswers,
            operation,
            evidence,
            attachments,
            existingTipTapJson: existingTipTapJson ?? undefined,
          }),
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
