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
  PageDraftSchema,
  SectionPatchResponseSchema,
} from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { createWorkspaceToolCatalog } from "../tools/wiki-workspace/tool-catalog";
import type { WikiWorkspace, WorkspaceManifest } from "../tools/wiki-workspace/workspace";
import { GENERATION_EXPLORATION_STEP_LIMIT, prepareExplorationStep } from "./agent-loop";
import type { ModelProgram } from "./event-sink";
import {
  CLARIFICATION_PROMPT,
  DRAFT_PROMPT,
  GENERATION_PROMPT_VERSION,
  PLANNING_PROMPT,
  WORKSPACE_INSTRUCTIONS,
} from "./prompts";
import { generateValidatedObject } from "./structured-output";

/** The Model layer owns LLM execution but never creates a database client. */
export interface GenerationModelContext {
  sourceText: string;
  inputs: IngestionInputs;
  workspace: WikiWorkspace;
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
  generationManifest(workspace: WorkspaceManifest, sourceHash?: string): Record<string, unknown>;
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
  workspace: WikiWorkspace,
  manifest: WorkspaceManifest,
): Promise<string> {
  const unique = new Map<string, { path: string; start?: number; end?: number }>();
  for (const reference of manifest.references) {
    unique.set(`${reference.path}:${reference.lineStart ?? 1}:${reference.lineEnd ?? ""}`, {
      path: reference.path,
      start: reference.lineStart,
      end: reference.lineEnd,
    });
  }
  if (![...unique.values()].some((reference) => reference.path === "/sources/source.md")) {
    unique.set("source", { path: "/sources/source.md", start: 1, end: 400 });
  }
  const chunks: string[] = [];
  for (const reference of [...unique.values()].slice(0, 12)) {
    const read = await workspace.cat(reference.path, {
      startLine: reference.start,
      endLine: reference.end,
    });
    chunks.push(
      `## ${reference.path}:${read.data.lineStart}-${read.data.lineEnd}\n${read.data.content}`,
    );
  }
  return chunks.join("\n\n");
}

export function createIngestionModelGateway(
  env: Env,
  eventSink?: ExecutionEventSink,
): ModelGateway {
  async function runAgentObject<T>(options: {
    program: Extract<ModelProgram, "clarify" | "plan">;
    workspace: WikiWorkspace;
    schema: z.ZodType<T>;
    name: string;
    system: string;
    prompt: string;
    attachments: FilePart[];
  }): Promise<T> {
    await emitSafely(eventSink, { type: "model_started", program: options.program });
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: options.prompt } as TextPart, ...options.attachments],
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
        return prepareExplorationStep(stepNumber);
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
        attachments: await context.loadAttachments(),
      });
      return { plan, manifest: context.workspace.manifest() };
    },

    async generateOperations(context, plan, manifest) {
      const evidence = await loadEvidence(context.workspace, manifest);
      const attachments = await context.loadAttachments();
      const model = createWikiModelFromEnv(env);
      const operations: ChangesetOperation[] = [];

      for (const [index, operation] of plan.operations.entries()) {
        await emitSafely(eventSink, {
          type: "operation_started",
          index,
          total: plan.operations.length,
          operationType: operation.type,
        });
        await emitSafely(eventSink, { type: "model_started", program: "draft" });
        if (operation.type === "create") {
          const draft = await model.generateObject({
            schema: PageDraftSchema,
            schemaName: "PageDraft",
            system: DRAFT_PROMPT,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `操作:\n${JSON.stringify(operation)}\n\nEvidence:\n${evidence}`,
                  },
                  ...attachments,
                ],
              },
            ],
            temperature: 0.2,
            maxRetries: 0,
          });
          operations.push({
            type: "create",
            tempId: operation.tempId,
            rationale: operation.rationale,
            draft,
            patch: null,
          });
        } else {
          const existingTipTapJson = await context.loadExistingPageContent(operation.pageId);
          if (!existingTipTapJson) {
            throw new Error(`Planned update page no longer exists: ${operation.pageId}`);
          }
          const patch = await model.generateObject({
            schema: SectionPatchResponseSchema,
            schemaName: "SectionPatchResponse",
            system: DRAFT_PROMPT,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `更新操作:\n${JSON.stringify(operation)}\n\nEvidence:\n${evidence}`,
                  },
                  ...attachments,
                ],
              },
            ],
            temperature: 0.2,
            maxRetries: 0,
          });
          operations.push({
            type: "update",
            pageId: operation.pageId,
            pageTitle: operation.pageTitle,
            rationale: operation.rationale,
            draft: null,
            patch: { ...patch, pageId: operation.pageId },
            existingTipTapJson,
          });
        }
        await emitSafely(eventSink, {
          type: "operation_completed",
          index,
          total: plan.operations.length,
        });
      }
      return operations;
    },

    generationManifest(workspace, sourceHash) {
      return {
        model: getWikiModelId(env),
        promptVersion: GENERATION_PROMPT_VERSION,
        sourceHash,
        evidence: workspace.references,
        toolOutcomes: workspace.tools,
        tokenUsage: workspace.budget,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
