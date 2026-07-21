/** Worker composition adapter joining Model and Tool ports to D1-backed workspace data. */
import type { FilePart } from "ai";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import type {
  ChangesetOperation,
  ClarificationResult,
  IngestionInputs,
  OperationPlan,
} from "../../../shared/ingestion/domain";
import {
  type GenerationModelContext,
  createIngestionModelGateway,
} from "./model/ingestion-model-gateway";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { createD1WikiWorkspaceStore } from "./persistence/d1/wiki-read-repository";
import { loadIngestionAttachmentParts as loadWorkerAttachmentParts } from "./tools/attachments";
import {
  type SourceFile,
  type WorkspaceActor,
  type WorkspaceManifest,
  createWikiWorkspace,
} from "./tools/wiki-workspace/workspace";

type Db = DrizzleD1Database<typeof schema>;

export interface GenerationContext {
  db: Db;
  actor: WorkspaceActor;
  sourceText: string;
  inputs: IngestionInputs;
}

function sourceFiles(sourceText: string): SourceFile[] {
  return [{ name: "source.md", load: async () => sourceText }];
}

function makeModelContext(env: Env, context: GenerationContext): GenerationModelContext {
  return {
    sourceText: context.sourceText,
    inputs: context.inputs,
    workspace: createWikiWorkspace({
      store: createD1WikiWorkspaceStore(context.db, context.actor),
      sources: sourceFiles(context.sourceText),
    }),
    loadAttachments: () => loadIngestionAttachmentParts(env, context.inputs),
    loadExistingPageContent: async (pageId) => {
      const row = await context.db
        .select({ contentJa: schema.pages.contentJa })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId))
        .get();
      return row?.contentJa ?? null;
    },
  };
}

export function loadIngestionAttachmentParts(
  env: Env,
  inputs: IngestionInputs,
): Promise<FilePart[]> {
  return loadWorkerAttachmentParts(env.BUCKET, inputs);
}

export async function clarifySources(
  env: Env,
  context: GenerationContext,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<{ result: ClarificationResult; manifest: WorkspaceManifest }> {
  return createIngestionModelGateway(env, events).clarify(makeModelContext(env, context));
}

export async function planGeneration(
  env: Env,
  context: GenerationContext,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<{ plan: OperationPlan; manifest: WorkspaceManifest }> {
  return createIngestionModelGateway(env, events).plan(makeModelContext(env, context));
}

export async function generateOperations(
  env: Env,
  context: GenerationContext,
  plan: OperationPlan,
  manifest: WorkspaceManifest,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<ChangesetOperation[]> {
  return createIngestionModelGateway(env, events).generateOperations(
    makeModelContext(env, context),
    plan,
    manifest,
  );
}

export function generationManifest(
  env: Env,
  workspace: WorkspaceManifest,
  sourceHash?: string,
): Record<string, unknown> {
  return createIngestionModelGateway(env).generationManifest(workspace, sourceHash);
}
