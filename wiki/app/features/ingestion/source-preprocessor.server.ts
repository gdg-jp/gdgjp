import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { isGoogleSheetsUrl } from "~/lib/google-drive-utils";
import {
  exportFileAsText,
  extractFileId,
  getDriveFileName,
  refreshAccessToken,
} from "~/lib/google-drive.server";
import { extractFormId, fetchFormData } from "~/lib/google-forms.server";
import { computeSurveyStats, formatSurveyStatsAsText } from "~/lib/survey-stats.server";
import { type ExtractedUrl, extractUrls, fetchUrlViaJina } from "~/lib/url-extract";
import type { AiDraftJson, IngestionInputs, SourceUrl } from "./contracts";
import { updateIngestionPhase } from "./persistence.server";
import { persistNormalizedSource } from "./source-artifacts.server";

type Db = ReturnType<typeof drizzle>;

export interface IngestionResumeContext {
  fileUris: { uri: string; mimeType: string }[];
  clarificationAnswers: string;
  googleDocText?: string;
  selectedUrls?: string[];
  priorSources?: SourceUrl[];
  sourceArtifactKey?: string;
}

export interface PreparedSources {
  userText: string;
  fileUris: { uri: string; mimeType: string }[];
  warnings: string[];
  sourceTexts: string[];
  sources: SourceUrl[];
  skipClarification: boolean;
  isPostClarification: boolean;
  sourceArtifactKey?: string;
}

function r2Reference(key: string, mimeType: string): { uri: string; mimeType: string } {
  return { uri: `r2://${key}`, mimeType };
}

async function getDriveAccessToken(env: Env, db: Db, userId: string): Promise<string> {
  const token = await db
    .select()
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, userId))
    .get();
  if (!token)
    throw new Error("Googleの認証が見つかりません。設定画面からGoogleを接続してください。");
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

function collectUrls(baseText: string, sourceTexts: string[]): ExtractedUrl[] {
  const results: ExtractedUrl[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    ...extractUrls(baseText, "user_text"),
    ...sourceTexts.flatMap((text) => extractUrls(text, "google_doc")),
  ]) {
    if (!seen.has(candidate.url)) {
      seen.add(candidate.url);
      results.push(candidate);
    }
  }
  return results.slice(0, 5);
}

export async function prepareSources(
  env: Env,
  db: Db,
  sessionId: string,
  userId: string,
  inputs: IngestionInputs,
  resume?: IngestionResumeContext,
): Promise<{ status: "continue"; data: PreparedSources } | { status: "awaiting_url_selection" }> {
  const baseText = inputs.texts.join("\n\n");
  const fileUris = resume ? [...resume.fileUris] : [];
  const warnings: string[] = [];
  const sourceTexts = resume?.googleDocText ? [resume.googleDocText] : [];
  const sources = resume?.priorSources ? [...resume.priorSources] : [];
  let skipClarification = false;
  let sourceArtifactKey = resume?.sourceArtifactKey;

  if (!resume) {
    await updateIngestionPhase(db, sessionId, "parsing");
    for (const key of inputs.imageKeys) {
      const object = await env.BUCKET.head(key);
      if (!object) throw new Error(`Uploaded image not found in R2: ${key}`);
      fileUris.push(
        r2Reference(key, object.httpMetadata?.contentType ?? "application/octet-stream"),
      );
    }
    for (const key of inputs.pdfKeys ?? []) {
      const object = await env.BUCKET.head(key);
      if (!object) throw new Error(`Uploaded PDF not found in R2: ${key}`);
      fileUris.push(r2Reference(key, "application/pdf"));
    }

    if (inputs.googleDocUrls.length > 0) {
      const token = await getDriveAccessToken(env, db, userId);
      for (const url of inputs.googleDocUrls) {
        const fileId = extractFileId(url);
        const name = await getDriveFileName(fileId, token).catch(() => fileId);
        sources.push({ url, title: name });
        const mimeType = isGoogleSheetsUrl(url) ? "text/csv" : "text/plain";
        sourceTexts.push(await exportFileAsText(fileId, token, mimeType));
      }
    }

    if (inputs.googleFormUrl) {
      const formId = extractFormId(inputs.googleFormUrl);
      if (!formId) throw new Error("Invalid Google Form URL");
      const token = await getDriveAccessToken(env, db, userId);
      const form = await fetchFormData(formId, token);
      sourceTexts.push(
        formatSurveyStatsAsText(
          computeSurveyStats(form),
          inputs.eventTitle ?? form.structure.title,
        ),
      );
      sources.push({ url: inputs.googleFormUrl, title: `Google Form: ${form.structure.title}` });
      skipClarification = true;
    }

    sourceArtifactKey = await persistNormalizedSource(
      env,
      db,
      sessionId,
      [baseText, ...sourceTexts].filter(Boolean).join("\n\n---\n\n"),
    );
    const extractedUrls = collectUrls(baseText, sourceTexts);
    if (extractedUrls.length > 0) {
      const draft: AiDraftJson = {
        phase: "url_selection",
        urls: extractedUrls,
        fileUris,
        sourceArtifactKey,
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
  }

  if (resume?.selectedUrls) {
    await updateIngestionPhase(db, sessionId, "fetching_urls");
    const fetched: string[] = [];
    for (const url of resume.selectedUrls) {
      const result = await fetchUrlViaJina(url);
      if (result.error !== undefined) {
        warnings.push(`${url}: ${result.error}`);
        sources.push({ url, title: url });
        continue;
      }
      fetched.push(`### ${url}\n${result.markdown}`);
      const title = result.markdown.match(/^(?:Title:\s*(.+)|#\s+(.+))/m);
      sources.push({ url, title: (title?.[1] ?? title?.[2])?.trim() || url });
    }
    if (fetched.length > 0) sourceTexts.push(`## 参考URL\n${fetched.join("\n\n")}`);
    sourceArtifactKey = await persistNormalizedSource(
      env,
      db,
      sessionId,
      [baseText, ...sourceTexts].filter(Boolean).join("\n\n---\n\n"),
    );
  }

  const userText = [resume?.clarificationAnswers, baseText, ...sourceTexts]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n---\n\n");
  return {
    status: "continue",
    data: {
      userText,
      fileUris,
      warnings,
      sourceTexts,
      sources,
      skipClarification,
      isPostClarification: Boolean(resume?.clarificationAnswers),
      sourceArtifactKey,
    },
  };
}
