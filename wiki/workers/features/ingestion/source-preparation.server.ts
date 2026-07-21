/** Worker composition facade for source adapters and node persistence. */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import { refreshAccessToken } from "../../../app/lib/google-drive.server";
import { extractUrls } from "../../../app/lib/url-extract";
import type { AiDraftJson, IngestionInputs, SourceUrl } from "../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { D1IngestionSessionRepository } from "./persistence/d1/ingestion-session-repository";
import { updateIngestionPhase } from "./persistence/ingestion-result-writer.server";
import { R2WorkspaceSourceStore } from "./persistence/r2/source-artifact-store";
import { createGoogleDriveTool } from "./tools/google-drive";
import { createGoogleFormsTool } from "./tools/google-forms";
import {
  type SourcePreparationResume,
  prepareSources as prepareWorkerSources,
} from "./tools/source-preprocessor";
import { fetchWebSource } from "./tools/web-fetch";

type Db = ReturnType<typeof drizzle>;

export interface IngestionResumeContext extends SourcePreparationResume {
  fileUris: { uri: string; mimeType: string }[];
  clarificationAnswers: string;
  priorSources?: SourceUrl[];
}

export interface PreparedSources {
  userInput: string;
  clarificationAnswers?: string;
  fileUris: { uri: string; mimeType: string }[];
  warnings: string[];
  sources: SourceUrl[];
  skipClarification: boolean;
  isPostClarification: boolean;
}

async function getDriveAccessToken(env: Env, db: Db, userId: string): Promise<string> {
  const token = await db
    .select()
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, userId))
    .get();
  if (!token) {
    throw new Error("Googleの認証が見つかりません。設定画面からGoogleを接続してください。");
  }
  if (token.expiresAt >= new Date() || !token.refreshToken) return token.accessToken;
  const refreshed = await refreshAccessToken(
    token.refreshToken,
    env.GOOGLE_DOCS_CLIENT_ID,
    env.GOOGLE_DOCS_CLIENT_SECRET,
  );
  await db
    .update(schema.googleDriveTokens)
    .set({
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.googleDriveTokens.userId, userId));
  return refreshed.accessToken;
}

export async function prepareSources(
  env: Env,
  db: Db,
  sessionId: string,
  userId: string,
  inputs: IngestionInputs,
  resume?: IngestionResumeContext,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<{ status: "continue"; data: PreparedSources } | { status: "awaiting_url_selection" }> {
  await updateIngestionPhase(db, sessionId, resume?.selectedUrls ? "fetching_urls" : "parsing");
  const tokens = { getAccessToken: () => getDriveAccessToken(env, db, userId) };
  const drive = createGoogleDriveTool(tokens);
  const forms = createGoogleFormsTool(tokens);
  const artifactStore = new R2WorkspaceSourceStore(
    env.BUCKET,
    new D1IngestionSessionRepository(env.DB),
  );
  const prepared = await prepareWorkerSources(
    inputs,
    {
      attachmentExists: async (key) => {
        const object = await env.BUCKET.head(key);
        return object ? { mimeType: object.httpMetadata?.contentType } : null;
      },
      exportGoogleDocument: (url) => drive.exportDocument(url),
      exportGoogleForm: (url, eventTitle) => forms.exportForm(url, eventTitle),
      extractUrls,
      fetchWebPage: fetchWebSource,
      persistWorkspaceNodes: (nodes) =>
        artifactStore.persistWorkspaceNodes(sessionId, nodes).then(() => {}),
      eventSink: events,
    },
    resume,
  );
  if (prepared.urlCandidates.length > 0) {
    const draft: AiDraftJson = {
      phase: "url_selection",
      urls: prepared.urlCandidates,
      fileUris: prepared.fileUris,
      sources: prepared.sources.length ? prepared.sources : undefined,
      skipClarification: prepared.skipClarification,
    };
    await db
      .update(schema.ingestionSessions)
      .set({
        aiDraftJson: JSON.stringify(draft),
        status: "awaiting_url_selection",
        phaseMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, sessionId));
    return { status: "awaiting_url_selection" };
  }
  return {
    status: "continue",
    data: {
      userInput: prepared.userInput,
      clarificationAnswers: prepared.clarificationAnswers,
      fileUris: prepared.fileUris,
      warnings: prepared.warnings,
      sources: prepared.sources,
      skipClarification: prepared.skipClarification,
      isPostClarification: prepared.isPostClarification,
    },
  };
}
