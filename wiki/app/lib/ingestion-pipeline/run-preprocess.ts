import type { BrowserWorker } from "@cloudflare/puppeteer";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { runPdfConverter, uploadFileToGemini } from "../gemini.server";
import { isGoogleSheetsUrl } from "../google-drive-utils";
import {
  exportFileAsPdf,
  exportFileAsText,
  extractFileId,
  getDriveFileName,
  refreshAccessToken,
} from "../google-drive.server";
import { extractFormId, fetchFormData } from "../google-forms.server";
import { persistNormalizedSource } from "../source-artifacts.server";
import { computeSurveyStats, formatSurveyStatsAsText } from "../survey-stats.server";
import { type ExtractedUrl, extractUrls, fetchUrlAsPdf, fetchUrlViaJina } from "../url-extract";
import { updateIngestionPhase } from "./helpers";
import type { AiDraftJson, IngestionInputs, SourceUrl } from "./types";

const USE_PDF_CONVERTER = false;
const USE_URL_PDF_RENDERER = false;

type Db = ReturnType<typeof drizzle>;

export interface IngestionResumeContext {
  fileUris: { uri: string; mimeType: string }[];
  clarificationAnswers: string;
  googleDocText?: string;
  selectedUrls?: string[];
  priorSources?: SourceUrl[];
  sourceArtifactKey?: string;
}

export interface PreparedPipelineData {
  baseUserText: string;
  fileUris: { uri: string; mimeType: string }[];
  warnings: string[];
  docTexts: string[];
  sources: SourceUrl[];
  skipPhase0: boolean;
  isPostClarification: boolean;
  isPostUrlSelection: boolean;
  clarificationAnswers?: string;
  sourceArtifactKey?: string;
}

export async function preparePipelineInputs(
  env: Env,
  db: Db,
  sessionId: string,
  userId: string,
  inputs: IngestionInputs,
  resumeContext?: IngestionResumeContext,
): Promise<
  { status: "continue"; data: PreparedPipelineData } | { status: "awaiting_url_selection" }
> {
  const baseUserText = inputs.texts.join("\n\n");
  let fileUris: { uri: string; mimeType: string }[];
  const warnings: string[] = [];
  const docTexts: string[] = [];
  const sources: SourceUrl[] = resumeContext?.priorSources ? [...resumeContext.priorSources] : [];
  let skipPhase0 = false;
  let sourceArtifactKey = resumeContext?.sourceArtifactKey;

  const isPostClarification = !!resumeContext?.clarificationAnswers;
  const isPostUrlSelection = !!resumeContext?.selectedUrls && !isPostClarification;

  if (resumeContext) {
    fileUris = resumeContext.fileUris;
    if (resumeContext.googleDocText) {
      docTexts.push(resumeContext.googleDocText);
    }

    if (inputs.googleDocUrls.length > 0) {
      const seenSourceUrls = new Set(sources.map((s) => s.url));
      const tokenRow = await db
        .select()
        .from(schema.googleDriveTokens)
        .where(eq(schema.googleDriveTokens.userId, userId))
        .get();
      if (tokenRow) {
        let accessToken = tokenRow.accessToken;
        const now = new Date();
        if (tokenRow.expiresAt < now && tokenRow.refreshToken) {
          try {
            const refreshed = await refreshAccessToken(
              tokenRow.refreshToken,
              env.GOOGLE_DOCS_CLIENT_ID,
              env.GOOGLE_DOCS_CLIENT_SECRET,
            );
            accessToken = refreshed.accessToken;
          } catch {
            // ignore refresh errors — sources are best-effort
          }
        }
        for (const docUrl of inputs.googleDocUrls) {
          if (seenSourceUrls.has(docUrl)) continue;
          const fileId = extractFileId(docUrl);
          try {
            const fileName = await getDriveFileName(fileId, accessToken);
            sources.push({ url: docUrl, title: fileName });
          } catch {
            sources.push({ url: docUrl, title: fileId });
          }
          seenSourceUrls.add(docUrl);
        }
      } else {
        for (const docUrl of inputs.googleDocUrls) {
          if (seenSourceUrls.has(docUrl)) continue;
          sources.push({ url: docUrl, title: extractFileId(docUrl) });
          seenSourceUrls.add(docUrl);
        }
      }
    }
  } else {
    fileUris = [];

    await updateIngestionPhase(db, sessionId, "parsing");

    if (inputs.imageFiles && inputs.imageFiles.length > 0) {
      fileUris = await Promise.all(
        inputs.imageFiles.map((img) =>
          uploadFileToGemini(img.buffer, img.mimeType, img.name, env.GEMINI_API_KEY).then(
            (uri) => ({
              uri,
              mimeType: img.mimeType,
            }),
          ),
        ),
      );
    } else {
      fileUris = await Promise.all(
        inputs.imageKeys.map(async (key) => {
          const obj = await env.BUCKET.get(key);
          if (!obj) throw new Error(`Uploaded image not found in R2: ${key}`);
          const mimeType = obj.httpMetadata?.contentType ?? "application/octet-stream";
          const name = key.split("/").at(-1) ?? key;
          const buffer = await obj.arrayBuffer();
          const uri = await uploadFileToGemini(buffer, mimeType, name, env.GEMINI_API_KEY);
          return { uri, mimeType };
        }),
      );
    }

    await step1bProcessPdfs(env, inputs, fileUris, docTexts);
    await step2ProcessGoogleDocs(env, db, userId, inputs, fileUris, docTexts, sources, warnings);
    skipPhase0 = await step24ProcessGoogleForm(env, db, userId, inputs, docTexts, sources);

    const urlsToShow = collectExtractedUrls(baseUserText, docTexts);
    sourceArtifactKey = await persistNormalizedSource(
      env,
      db,
      sessionId,
      docTexts.join("\n\n---\n\n"),
    );
    if (urlsToShow.length > 0) {
      const aiDraftJson: AiDraftJson = {
        phase: "url_selection",
        urls: urlsToShow,
        fileUris,
        sourceArtifactKey,
      };
      await db
        .update(schema.ingestionSessions)
        .set({
          aiDraftJson: JSON.stringify(aiDraftJson),
          status: "awaiting_url_selection",
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, sessionId));
      return { status: "awaiting_url_selection" };
    }
  }

  return {
    status: "continue",
    data: {
      baseUserText,
      fileUris,
      warnings,
      docTexts,
      sources,
      skipPhase0,
      isPostClarification,
      isPostUrlSelection,
      clarificationAnswers: resumeContext?.clarificationAnswers,
      sourceArtifactKey,
    },
  };
}

async function step1bProcessPdfs(
  env: Env,
  inputs: IngestionInputs,
  fileUris: { uri: string; mimeType: string }[],
  docTexts: string[],
): Promise<void> {
  console.log(
    "[ingestion-pipeline] step 1b: pdfFiles:",
    inputs.pdfFiles?.length ?? 0,
    "pdfKeys:",
    inputs.pdfKeys?.length ?? 0,
    inputs.pdfKeys,
  );
  if (inputs.pdfFiles && inputs.pdfFiles.length > 0) {
    console.log("[ingestion-pipeline] step 1b: using pdfFiles path");
    const pdfTexts = (
      await Promise.all(
        inputs.pdfFiles.map(async (pdf) => {
          console.log("[ingestion-pipeline] step 1b: uploading pdfFile:", pdf.name);
          const uri = await uploadFileToGemini(
            pdf.buffer,
            pdf.mimeType,
            pdf.name,
            env.GEMINI_API_KEY,
          );
          console.log("[ingestion-pipeline] step 1b: uploaded pdfFile:", pdf.name, "→", uri);
          if (USE_PDF_CONVERTER) {
            return runPdfConverter(env.GEMINI_API_KEY, uri, pdf.name)
              .then((text) => {
                console.log(
                  "[ingestion-pipeline] step 1b: converted pdfFile:",
                  pdf.name,
                  "text length:",
                  text.length,
                );
                return `### ${pdf.name}\n${text}`;
              })
              .catch((err) => {
                console.warn("[ingestion-pipeline] PDF converter failed:", pdf.name, err);
                return `### ${pdf.name}\n(PDF変換に失敗しました)`;
              });
          }
          fileUris.push({ uri, mimeType: "application/pdf" });
          return null;
        }),
      )
    ).filter((t): t is string => t !== null);
    if (pdfTexts.length > 0) docTexts.push(`## 添付PDF\n${pdfTexts.join("\n\n")}`);
  } else if (inputs.pdfKeys && inputs.pdfKeys.length > 0) {
    console.log("[ingestion-pipeline] step 1b: using pdfKeys path");
    const pdfTexts = (
      await Promise.all(
        inputs.pdfKeys.map(async (key) => {
          console.log("[ingestion-pipeline] step 1b: fetching pdfKey from R2:", key);
          const obj = await env.BUCKET.get(key);
          if (!obj) throw new Error(`Uploaded PDF not found in R2: ${key}`);
          const buffer = await obj.arrayBuffer();
          const name = key.split("/").at(-1) ?? key;
          console.log("[ingestion-pipeline] step 1b: uploading pdfKey to Gemini:", name);
          const uri = await uploadFileToGemini(buffer, "application/pdf", name, env.GEMINI_API_KEY);
          console.log("[ingestion-pipeline] step 1b: uploaded pdfKey:", name, "→", uri);
          if (USE_PDF_CONVERTER) {
            return runPdfConverter(env.GEMINI_API_KEY, uri, name)
              .then((text) => {
                console.log(
                  "[ingestion-pipeline] step 1b: converted pdfKey:",
                  name,
                  "text length:",
                  text.length,
                );
                return `### ${name}\n${text}`;
              })
              .catch((err) => {
                console.warn("[ingestion-pipeline] PDF converter failed:", name, err);
                return `### ${name}\n(PDF変換に失敗しました)`;
              });
          }
          fileUris.push({ uri, mimeType: "application/pdf" });
          return null;
        }),
      )
    ).filter((t): t is string => t !== null);
    if (pdfTexts.length > 0) docTexts.push(`## 添付PDF\n${pdfTexts.join("\n\n")}`);
  } else {
    console.log("[ingestion-pipeline] step 1b: no PDFs to process");
  }
}

async function step2ProcessGoogleDocs(
  env: Env,
  db: Db,
  userId: string,
  inputs: IngestionInputs,
  fileUris: { uri: string; mimeType: string }[],
  docTexts: string[],
  sources: SourceUrl[],
  warnings: string[],
): Promise<void> {
  for (const docUrl of inputs.googleDocUrls) {
    const fileId = extractFileId(docUrl);

    const tokenRow = await db
      .select()
      .from(schema.googleDriveTokens)
      .where(eq(schema.googleDriveTokens.userId, userId))
      .get();

    if (!tokenRow) {
      throw new Error(
        `Google Driveの認証が見つかりません。設定画面からGoogle Driveを再接続してください。(URL: ${docUrl})`,
      );
    }

    let accessToken = tokenRow.accessToken;
    const now = new Date();
    if (tokenRow.expiresAt < now && tokenRow.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(
          tokenRow.refreshToken,
          env.GOOGLE_DOCS_CLIENT_ID,
          env.GOOGLE_DOCS_CLIENT_SECRET,
        );
        accessToken = refreshed.accessToken;
        await db
          .update(schema.googleDriveTokens)
          .set({
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt,
            updatedAt: now,
          })
          .where(eq(schema.googleDriveTokens.userId, userId));
      } catch (refreshErr) {
        const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        throw new Error(
          `Google Driveのアクセスが無効になりました。設定画面からGoogle Driveを再接続してください。(${msg})`,
        );
      }
    }

    try {
      const fileName = await getDriveFileName(fileId, accessToken);
      sources.push({ url: docUrl, title: fileName });
    } catch {
      sources.push({ url: docUrl, title: fileId });
    }

    const exportMime = isGoogleSheetsUrl(docUrl) ? "text/csv" : "text/plain";
    const docText = await exportFileAsText(fileId, accessToken, exportMime);
    docTexts.push(docText);

    try {
      const exported = await exportFileAsPdf(fileId, accessToken);
      if (exported.warning) warnings.push(exported.warning);

      const uri = await uploadFileToGemini(
        exported.buffer,
        exported.mimeType,
        `google-drive-${fileId}`,
        env.GEMINI_API_KEY,
      );
      fileUris.push({ uri, mimeType: exported.mimeType });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `Google DriveファイルのPDFアップロードに失敗しました（テキストは取得済み）: ${msg}`,
      );
    }
  }
}

async function step24ProcessGoogleForm(
  env: Env,
  db: Db,
  userId: string,
  inputs: IngestionInputs,
  docTexts: string[],
  sources: SourceUrl[],
): Promise<boolean> {
  if (!inputs.googleFormUrl) return false;

  const formId = extractFormId(inputs.googleFormUrl);
  if (!formId) {
    throw new Error("Invalid Google Form URL");
  }

  const tokenRow = await db
    .select()
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, userId))
    .get();

  if (!tokenRow) {
    throw new Error("Googleの認証が見つかりません。設定画面からGoogleを接続してください。");
  }

  let accessToken = tokenRow.accessToken;
  const now = new Date();
  if (tokenRow.expiresAt < now && tokenRow.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(
        tokenRow.refreshToken,
        env.GOOGLE_DOCS_CLIENT_ID,
        env.GOOGLE_DOCS_CLIENT_SECRET,
      );
      accessToken = refreshed.accessToken;
      await db
        .update(schema.googleDriveTokens)
        .set({
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
          updatedAt: now,
        })
        .where(eq(schema.googleDriveTokens.userId, userId));
    } catch (refreshErr) {
      const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
      throw new Error(
        `Googleのアクセスが無効になりました。設定画面からGoogleを再接続してください。(${msg})`,
      );
    }
  }

  const formData = await fetchFormData(formId, accessToken);
  const stats = computeSurveyStats(formData);
  const statsText = formatSurveyStatsAsText(stats, inputs.eventTitle ?? formData.structure.title);

  docTexts.push(statsText);
  sources.push({
    url: inputs.googleFormUrl,
    title: `Google Form: ${formData.structure.title}`,
  });

  return true;
}

function collectExtractedUrls(baseUserText: string, docTexts: string[]): ExtractedUrl[] {
  const allExtractedUrls: ExtractedUrl[] = [];
  const seenUrls = new Set<string>();

  for (const extracted of extractUrls(baseUserText, "user_text")) {
    if (!seenUrls.has(extracted.url)) {
      seenUrls.add(extracted.url);
      allExtractedUrls.push(extracted);
    }
  }
  for (const docText of docTexts) {
    for (const extracted of extractUrls(docText, "google_doc")) {
      if (!seenUrls.has(extracted.url)) {
        seenUrls.add(extracted.url);
        allExtractedUrls.push(extracted);
      }
    }
  }

  return allExtractedUrls.slice(0, 5);
}

export async function step26FetchSelectedUrls(
  env: Env,
  db: Db,
  sessionId: string,
  selectedUrls: string[],
  fileUris: { uri: string; mimeType: string }[],
  docTexts: string[],
  sources: SourceUrl[],
): Promise<void> {
  if (selectedUrls.length === 0) return;

  await updateIngestionPhase(db, sessionId, "fetching_urls");

  const jinaParts: string[] = [];
  for (const url of selectedUrls) {
    let uploadedPdf = false;

    if (USE_URL_PDF_RENDERER && env.BROWSER) {
      console.log("[ingestion-pipeline] step 2.6: trying PDF for", url);
      const pdfResult = await fetchUrlAsPdf(env.BROWSER as BrowserWorker, url);
      if (pdfResult.error === undefined) {
        const pdfByteLength = pdfResult.buffer.byteLength;
        if (pdfByteLength === 0) {
          console.warn("[ingestion-pipeline] URL PDF is empty, falling back to Jina:", url);
        } else {
          const hostname = new URL(url).hostname;
          try {
            const geminiUri = await uploadFileToGemini(
              pdfResult.buffer,
              "application/pdf",
              hostname,
              env.GEMINI_API_KEY,
            );
            fileUris.push({ uri: geminiUri, mimeType: "application/pdf" });
            sources.push({ url, title: pdfResult.title || url });
            uploadedPdf = true;
            console.log("[ingestion-pipeline] URL PDF uploaded:", url, "→", geminiUri);
          } catch (uploadErr) {
            console.warn(
              "[ingestion-pipeline] URL PDF Gemini upload failed, falling back to Jina:",
              url,
              uploadErr,
            );
          }
        }
      } else {
        console.warn(
          "[ingestion-pipeline] URL PDF failed, falling back to Jina:",
          url,
          pdfResult.error,
        );
      }
    }

    if (!uploadedPdf) {
      console.log("[ingestion-pipeline] step 2.6: fetching via Jina:", url);
      const jinaResult = await fetchUrlViaJina(url);
      if (jinaResult.error !== undefined) {
        console.warn("[ingestion-pipeline] URL Jina fetch failed:", url, jinaResult.error);
        jinaParts.push(`### ${url}\n(取得失敗: ${jinaResult.error})`);
        sources.push({ url, title: url });
      } else {
        console.log(
          "[ingestion-pipeline] URL Jina fetch ok:",
          url,
          `${jinaResult.markdown.length} chars`,
          jinaResult.truncated ? "(truncated)" : "",
        );
        const suffix = jinaResult.truncated ? "\n\n(... 10,000文字で切り詰めました)" : "";
        jinaParts.push(`### ${url}\n${jinaResult.markdown}${suffix}`);
        const titleMatch = jinaResult.markdown?.match(/^(?:Title:\s*(.+)|#\s+(.+))/m);
        const title = (titleMatch?.[1] ?? titleMatch?.[2])?.trim() || url;
        sources.push({ url, title });
      }
    }
  }

  if (jinaParts.length > 0) {
    docTexts.push(`## 参考URL（ユーザーが選択した外部ページ）\n${jinaParts.join("\n\n")}`);
  }
}
