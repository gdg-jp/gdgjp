import {
  type FilePart,
  type ModelMessage,
  Output,
  type TextPart,
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "~/db/schema";
import {
  createWikiLanguageModelFromEnv,
  createWikiModelFromEnv,
  getWikiModelId,
} from "~/features/ai/model/index.server";
import type {
  ChangesetOperation,
  ClarificationResult,
  IngestionInputs,
  OperationPlan,
} from "./contracts";
import {
  ClarificationResultSchema,
  OperationPlanSchema,
  PageDraftSchema,
  SectionPatchResponseSchema,
} from "./contracts";
import {
  CLARIFICATION_PROMPT,
  DRAFT_PROMPT,
  GENERATION_PROMPT_VERSION,
  PLANNING_PROMPT,
  WORKSPACE_INSTRUCTIONS,
} from "./prompts";
import {
  type SourceFile,
  type WikiWorkspace,
  type WorkspaceActor,
  type WorkspaceManifest,
  createWikiWorkspace,
} from "./wiki-workspace.server";

type Db = DrizzleD1Database<typeof schema>;

const GENERATION_TOOL_STEP_LIMIT = 12;

export interface GenerationContext {
  db: Db;
  actor: WorkspaceActor;
  sourceText: string;
  inputs: IngestionInputs;
}

function workspaceTools(workspace: WikiWorkspace) {
  return {
    pwd: tool({
      description: "Print the current workspace directory.",
      inputSchema: z.object({}),
      execute: () => workspace.pwd(),
    }),
    cd: tool({
      description: "Change to an exact workspace directory.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) => workspace.cd(path),
    }),
    ls: tool({
      description: "List a bounded page of directory entries.",
      inputSchema: z.object({
        path: z.string().optional(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: ({ path, ...options }) => workspace.ls(path, options),
    }),
    cat: tool({
      description: "Read an exact file and bounded inclusive line range.",
      inputSchema: z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      execute: ({ path, ...options }) => workspace.cat(path, options),
    }),
    find: tool({
      description: "Find public Wiki paths by title or slug; use cat to read a match.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: ({ query, ...options }) => workspace.find(query, options),
    }),
    grep: tool({
      description: "Search public Wiki bodies and return bounded snippets; use cat for evidence.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
      execute: ({ query, ...options }) => workspace.grep(query, options),
    }),
  };
}

function sourceFiles(sourceText: string): SourceFile[] {
  return [{ name: "source.md", load: async () => sourceText }];
}

function makeWorkspace(context: GenerationContext): WikiWorkspace {
  return createWikiWorkspace({
    db: context.db,
    actor: context.actor,
    sources: sourceFiles(context.sourceText),
  });
}

export async function loadIngestionAttachmentParts(
  env: Env,
  inputs: IngestionInputs,
): Promise<FilePart[]> {
  const parts: FilePart[] = [];
  for (const key of [...inputs.imageKeys, ...(inputs.pdfKeys ?? [])].slice(0, 12)) {
    const object = await env.BUCKET.get(key);
    if (!object) continue;
    parts.push({
      type: "file",
      data: new Uint8Array(await object.arrayBuffer()),
      mediaType:
        object.httpMetadata?.contentType ??
        (key.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
      filename: key.split("/").at(-1),
    });
  }
  return parts;
}

async function agentObject<T>(options: {
  env: Env;
  workspace: WikiWorkspace;
  schema: z.ZodType<T>;
  name: string;
  system: string;
  prompt: string;
  attachments?: FilePart[];
}): Promise<T> {
  const content: Array<TextPart | FilePart> = [
    { type: "text", text: options.prompt },
    ...(options.attachments ?? []),
  ];
  const messages: ModelMessage[] = [
    {
      role: "user",
      content,
    },
  ];
  const result = await generateText({
    model: createWikiLanguageModelFromEnv(options.env),
    system: `${WORKSPACE_INSTRUCTIONS}\n\n${options.system}`,
    messages,
    tools: workspaceTools(options.workspace),
    // Two agentic passes plus URL fetches and at most five draft operations
    // must fit within the free Workflow's 50 external-subrequest ceiling.
    stopWhen: stepCountIs(GENERATION_TOOL_STEP_LIMIT),
    output: Output.object({ name: options.name, schema: options.schema }),
    temperature: 0.2,
    // Workflow steps own durable retries. Retrying here as well multiplies
    // provider calls and can exhaust a Worker's per-invocation subrequests.
    maxRetries: 0,
  });
  return result.output as T;
}

export async function clarifySources(
  env: Env,
  context: GenerationContext,
): Promise<{ result: ClarificationResult; manifest: WorkspaceManifest }> {
  const workspace = makeWorkspace(context);
  const result = await agentObject({
    env,
    workspace,
    schema: ClarificationResultSchema,
    name: "ClarificationResult",
    system: CLARIFICATION_PROMPT,
    prompt: "一次資料を workspace から読み、確認質問の必要性を判定してください。",
    attachments: await loadIngestionAttachmentParts(env, context.inputs),
  });
  return { result, manifest: workspace.manifest() };
}

export async function planGeneration(
  env: Env,
  context: GenerationContext,
): Promise<{ plan: OperationPlan; manifest: WorkspaceManifest }> {
  const workspace = makeWorkspace(context);
  const plan = await agentObject({
    env,
    workspace,
    schema: OperationPlanSchema,
    name: "OperationPlan",
    system: PLANNING_PROMPT,
    prompt: "一次資料を読み、必要な既存ページだけ探索して操作計画を作成してください。",
    attachments: await loadIngestionAttachmentParts(env, context.inputs),
  });
  return { plan, manifest: workspace.manifest() };
}

async function loadEvidence(
  context: GenerationContext,
  manifest: WorkspaceManifest,
): Promise<string> {
  const workspace = makeWorkspace(context);
  const unique = new Map<string, { path: string; start?: number; end?: number }>();
  for (const ref of manifest.references)
    unique.set(`${ref.path}:${ref.lineStart ?? 1}:${ref.lineEnd ?? ""}`, {
      path: ref.path,
      start: ref.lineStart,
      end: ref.lineEnd,
    });
  if (![...unique.values()].some((ref) => ref.path === "/sources/source.md"))
    unique.set("source", { path: "/sources/source.md", start: 1, end: 400 });
  const chunks: string[] = [];
  for (const ref of [...unique.values()].slice(0, 12)) {
    const read = await workspace.cat(ref.path, { startLine: ref.start, endLine: ref.end });
    chunks.push(`## ${ref.path}:${read.data.lineStart}-${read.data.lineEnd}\n${read.data.content}`);
  }
  return chunks.join("\n\n");
}

export async function generateOperations(
  env: Env,
  context: GenerationContext,
  plan: OperationPlan,
  manifest: WorkspaceManifest,
): Promise<ChangesetOperation[]> {
  const evidence = await loadEvidence(context, manifest);
  const model = createWikiModelFromEnv(env);
  const attachments = await loadIngestionAttachmentParts(env, context.inputs);
  const operations: ChangesetOperation[] = [];
  for (const operation of plan.operations) {
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
      const existing = await context.db
        .select({ contentJa: schema.pages.contentJa })
        .from(schema.pages)
        .where(eq(schema.pages.id, operation.pageId))
        .get();
      if (!existing) throw new Error(`Planned update page no longer exists: ${operation.pageId}`);
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
        existingTipTapJson: existing.contentJa,
      });
    }
  }
  return operations;
}

export function generationManifest(env: Env, workspace: WorkspaceManifest, sourceHash?: string) {
  return {
    model: getWikiModelId(env),
    promptVersion: GENERATION_PROMPT_VERSION,
    sourceHash,
    evidence: workspace.references,
    toolOutcomes: workspace.tools,
    tokenUsage: workspace.budget,
    generatedAt: new Date().toISOString(),
  };
}
