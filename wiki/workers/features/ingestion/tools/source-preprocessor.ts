import type { ExtractedUrl, IngestionInputs, SourceUrl } from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";

export type ExternalSourceCandidate = ExtractedUrl;

export interface PreparedSourceFile {
  uri: string;
  mimeType: string;
}

export interface SourceArtifactWriter {
  saveNormalizedSource(text: string): Promise<{ key: string } | undefined>;
}

/** All side effects are injected so this Tool layer has no knowledge of D1. */
export interface SourcePreprocessorDependencies {
  attachmentExists(key: string): Promise<{ mimeType?: string } | null>;
  exportGoogleDocument(url: string): Promise<{ title: string; text: string }>;
  exportGoogleForm(url: string, eventTitle?: string): Promise<{ title: string; text: string }>;
  extractUrls(text: string, origin: "user_text" | "google_doc"): ExternalSourceCandidate[];
  fetchWebPage(url: string): Promise<{ markdown?: string; error?: string }>;
  artifacts: SourceArtifactWriter;
  eventSink?: ExecutionEventSink;
}

export interface SourcePreparationResume {
  fileUris: PreparedSourceFile[];
  clarificationAnswers?: string;
  googleDocText?: string;
  selectedUrls?: string[];
  priorSources?: SourceUrl[];
  sourceArtifactKey?: string;
}

export interface PreparedSources {
  userText: string;
  fileUris: PreparedSourceFile[];
  warnings: string[];
  sourceTexts: string[];
  sources: SourceUrl[];
  skipClarification: boolean;
  isPostClarification: boolean;
  sourceArtifactKey?: string;
  urlCandidates: ExternalSourceCandidate[];
}

async function emitSafely(
  sink: ExecutionEventSink | undefined,
  event: Parameters<ExecutionEventSink["emit"]>[0],
): Promise<void> {
  try {
    await sink?.emit(event);
  } catch {
    // Telemetry is not part of the ingestion transaction.
  }
}

function sourceToolId(): string {
  return crypto.randomUUID();
}

async function callSourceTool<T>(
  deps: SourcePreprocessorDependencies,
  tool: "google_drive" | "google_forms" | "web_fetch",
  summary: string,
  execute: () => Promise<T>,
): Promise<T> {
  const toolCallId = sourceToolId();
  const startedAt = Date.now();
  await emitSafely(deps.eventSink, { type: "tool_started", toolCallId, tool, summary });
  try {
    const result = await execute();
    await emitSafely(deps.eventSink, {
      type: "tool_completed",
      toolCallId,
      tool,
      durationMs: Date.now() - startedAt,
      truncated: false,
    });
    return result;
  } catch (error) {
    await emitSafely(deps.eventSink, {
      type: "tool_failed",
      toolCallId,
      tool,
      errorCode: "source_tool_failed",
    });
    throw error;
  }
}

function collectUrls(
  baseText: string,
  sourceTexts: readonly string[],
  deps: SourcePreprocessorDependencies,
): ExternalSourceCandidate[] {
  const seen = new Set<string>();
  const results: ExternalSourceCandidate[] = [];
  for (const candidate of [
    ...deps.extractUrls(baseText, "user_text"),
    ...sourceTexts.flatMap((text) => deps.extractUrls(text, "google_doc")),
  ]) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    results.push(candidate);
  }
  return results.slice(0, 5);
}

/**
 * Normalizes uploads, Google sources and user-selected web pages into a
 * source artifact. State transitions and D1 writes deliberately belong to
 * orchestration/persistence, not this tool.
 */
export async function prepareSources(
  inputs: IngestionInputs,
  deps: SourcePreprocessorDependencies,
  resume?: SourcePreparationResume,
): Promise<PreparedSources> {
  const baseText = inputs.texts.join("\n\n");
  const fileUris = resume ? [...resume.fileUris] : [];
  const warnings: string[] = [];
  const sourceTexts = resume?.googleDocText ? [resume.googleDocText] : [];
  const sources = resume?.priorSources ? [...resume.priorSources] : [];
  let sourceArtifactKey = resume?.sourceArtifactKey;
  let skipClarification = false;

  if (!resume) {
    for (const key of inputs.imageKeys) {
      const object = await deps.attachmentExists(key);
      if (!object) throw new Error(`Uploaded image not found in R2: ${key}`);
      fileUris.push({
        uri: `r2://${key}`,
        mimeType: object.mimeType ?? "application/octet-stream",
      });
    }
    for (const key of inputs.pdfKeys ?? []) {
      const object = await deps.attachmentExists(key);
      if (!object) throw new Error(`Uploaded PDF not found in R2: ${key}`);
      fileUris.push({ uri: `r2://${key}`, mimeType: object.mimeType ?? "application/pdf" });
    }
    for (const url of inputs.googleDocUrls) {
      const document = await callSourceTool(deps, "google_drive", "Reading a Google document", () =>
        deps.exportGoogleDocument(url),
      );
      sources.push({ url, title: document.title });
      sourceTexts.push(document.text);
    }
    if (inputs.googleFormUrl) {
      const form = await callSourceTool(deps, "google_forms", "Reading a Google Form", () =>
        deps.exportGoogleForm(inputs.googleFormUrl as string, inputs.eventTitle),
      );
      sourceTexts.push(form.text);
      sources.push({ url: inputs.googleFormUrl, title: `Google Form: ${form.title}` });
      skipClarification = true;
    }
  }

  if (resume?.selectedUrls) {
    const fetched: string[] = [];
    for (const url of resume.selectedUrls.slice(0, 5)) {
      const result = await callSourceTool(deps, "web_fetch", "Fetching a selected web page", () =>
        deps.fetchWebPage(url),
      );
      if (result.error !== undefined) {
        warnings.push(`${url}: ${result.error}`);
        sources.push({ url, title: url });
        continue;
      }
      const markdown = result.markdown ?? "";
      fetched.push(`### ${url}\n${markdown}`);
      const title = markdown.match(/^(?:Title:\s*(.+)|#\s+(.+))/m);
      sources.push({ url, title: (title?.[1] ?? title?.[2])?.trim() || url });
    }
    if (fetched.length) sourceTexts.push(`## 参考URL\n${fetched.join("\n\n")}`);
  }

  const normalized = [baseText, ...sourceTexts].filter(Boolean).join("\n\n---\n\n");
  if (!sourceArtifactKey || resume?.selectedUrls) {
    sourceArtifactKey = (await deps.artifacts.saveNormalizedSource(normalized))?.key;
  }
  return {
    userText: [resume?.clarificationAnswers, baseText, ...sourceTexts]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n---\n\n"),
    fileUris,
    warnings,
    sourceTexts,
    sources,
    skipClarification,
    isPostClarification: Boolean(resume?.clarificationAnswers),
    sourceArtifactKey,
    urlCandidates: resume ? [] : collectUrls(baseText, sourceTexts, deps),
  };
}
