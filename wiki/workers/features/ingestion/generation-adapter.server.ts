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
import { createR2ManifestWorkspaceAdapter } from "./persistence/r2/manifest-workspace-adapter";
import type { WorkspaceSourceReference } from "./persistence/serialization/context-manifest-codec";
import { loadIngestionAttachmentParts as loadWorkerAttachmentParts } from "./tools/attachments";
import type { WorkspaceManifest } from "./tools/workspace/contracts";
import { normaliseAbsoluteWorkspacePath } from "./tools/workspace/paths";
import {
  WikiWorkspaceAdapter,
  type WorkspaceActor,
  resolveWikiWorkspacePage,
  wikiWorkspacePageTitle,
} from "./tools/workspace/wiki-adapter";
import { createMountedWorkspace } from "./tools/workspace/workspace";

type Db = DrizzleD1Database<typeof schema>;

export interface GenerationContext {
  db: Db;
  actor: WorkspaceActor;
  userInput: string;
  clarificationAnswers?: string;
  sourceNodes: readonly WorkspaceSourceReference[];
  inputs: IngestionInputs;
}

function makeModelContext(env: Env, context: GenerationContext): GenerationModelContext {
  const wikiStore = createD1WikiWorkspaceStore(context.db, context.actor);
  return {
    userInput: context.userInput,
    clarificationAnswers: context.clarificationAnswers,
    inputs: context.inputs,
    workspace: createMountedWorkspace({
      wiki: new WikiWorkspaceAdapter(wikiStore),
      googleDocs: createR2ManifestWorkspaceAdapter(env.BUCKET, "/google-docs", context.sourceNodes),
      websites: createR2ManifestWorkspaceAdapter(env.BUCKET, "/websites", context.sourceNodes),
      additionalMounts: [
        {
          mount: "/google-forms",
          adapter: createR2ManifestWorkspaceAdapter(
            env.BUCKET,
            "/google-forms",
            context.sourceNodes,
          ),
        },
      ],
    }),
    loadAttachments: () => loadIngestionAttachmentParts(env, context.inputs),
    resolveExistingWikiPage: async (absolutePath) => {
      let normalizedPath: string;
      try {
        normalizedPath = normaliseAbsoluteWorkspacePath(absolutePath);
      } catch {
        return null;
      }
      if (normalizedPath !== absolutePath || !normalizedPath.startsWith("/wiki/")) return null;
      const page = await resolveWikiWorkspacePage(wikiStore, normalizedPath.slice("/wiki/".length));
      if (!page || !(await wikiStore.canView(page))) return null;
      return { pageId: page.id, pageTitle: wikiWorkspacePageTitle(page) };
    },
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
  sourceHashes?: readonly string[],
): Record<string, unknown> {
  return createIngestionModelGateway(env).generationManifest(workspace, sourceHashes);
}
