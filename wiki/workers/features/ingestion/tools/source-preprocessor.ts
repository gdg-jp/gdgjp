import type { ExtractedUrl, IngestionInputs, SourceUrl } from "../../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "../orchestration/ports/tool-event-sink";
import { googleDocsPathSegment } from "./google-docs/workspace";
import { websiteWorkspacePath } from "./websites/path";

export type ExternalSourceCandidate = ExtractedUrl;

export interface PreparedSourceFile {
  uri: string;
  mimeType: string;
}

export interface PreparedWorkspaceNode {
  path: string;
  parentPath: string;
  title: string;
  kind: "google_document" | "google_tab" | "google_form" | "website";
  content?: string;
  mimeType?: string;
  sourceUrl?: string;
  externalId?: string;
}

export interface GoogleDocumentSource {
  title: string;
  nodes: Array<{
    path: string;
    parentPath: string | null;
    title: string;
    kind: "google_document" | "google_tab";
    content?: string;
    externalId: string;
  }>;
}

/** All side effects are injected so this Tool layer has no knowledge of D1 or R2. */
export interface SourcePreprocessorDependencies {
  attachmentExists(key: string): Promise<{ mimeType?: string } | null>;
  exportGoogleDocument(url: string): Promise<GoogleDocumentSource>;
  exportGoogleForm(url: string, eventTitle?: string): Promise<{ title: string; text: string }>;
  extractUrls(text: string, origin: "user_text" | "google_doc"): ExternalSourceCandidate[];
  fetchWebPage(url: string): Promise<{ markdown?: string; error?: string }>;
  persistWorkspaceNodes(nodes: readonly PreparedWorkspaceNode[]): Promise<void>;
  eventSink?: ExecutionEventSink;
}

export interface SourcePreparationResume {
  fileUris: PreparedSourceFile[];
  clarificationAnswers?: string;
  selectedUrls?: string[];
  priorSources?: SourceUrl[];
  skipClarification?: boolean;
}

export interface PreparedSources {
  userInput: string;
  clarificationAnswers?: string;
  fileUris: PreparedSourceFile[];
  warnings: string[];
  sources: SourceUrl[];
  skipClarification: boolean;
  isPostClarification: boolean;
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

async function callSourceTool<T>(
  deps: SourcePreprocessorDependencies,
  tool: "google_drive" | "google_forms" | "web_fetch",
  summary: string,
  execute: () => Promise<T>,
): Promise<T> {
  const toolCallId = crypto.randomUUID();
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
  userInput: string,
  googleNodeContents: readonly string[],
  deps: SourcePreprocessorDependencies,
): ExternalSourceCandidate[] {
  const seen = new Set<string>();
  const results: ExternalSourceCandidate[] = [];
  for (const candidate of [
    ...deps.extractUrls(userInput, "user_text"),
    ...googleNodeContents.flatMap((text) => deps.extractUrls(text, "google_doc")),
  ]) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    results.push(candidate);
  }
  return results.slice(0, 5);
}

function mountGoogleDocumentNodes(
  sourceUrl: string,
  nodes: GoogleDocumentSource["nodes"],
  rootName: string,
): PreparedWorkspaceNode[] {
  const originalRoot = nodes.find((node) => node.parentPath === null)?.path;
  return nodes.map((node) => {
    const relativePath = originalRoot
      ? `${rootName}${node.path.slice(originalRoot.length)}`
      : `${rootName}/${node.path}`;
    const relativeParent = node.parentPath
      ? originalRoot
        ? `${rootName}${node.parentPath.slice(originalRoot.length)}`
        : rootName
      : null;
    return {
      ...node,
      path: `/google-docs/${relativePath}`,
      parentPath: relativeParent ? `/google-docs/${relativeParent}` : "/google-docs",
      sourceUrl,
    };
  });
}

/**
 * Prepares only references and independently persisted workspace nodes. User-authored
 * text is returned separately and is never copied into the virtual filesystem.
 */
export async function prepareSources(
  inputs: IngestionInputs,
  deps: SourcePreprocessorDependencies,
  resume?: SourcePreparationResume,
): Promise<PreparedSources> {
  const userInput = inputs.texts.join("\n\n");
  const fileUris = resume ? [...resume.fileUris] : [];
  const warnings: string[] = [];
  const sources = resume?.priorSources ? [...resume.priorSources] : [];
  const workspaceNodes: PreparedWorkspaceNode[] = [];
  const googleNodeContents: string[] = [];
  const googleRootOccurrences = new Map<string, number>();
  let skipClarification = resume?.skipClarification ?? false;

  if (!resume) {
    for (const key of [...inputs.imageKeys, ...(inputs.pdfKeys ?? [])]) {
      const object = await deps.attachmentExists(key);
      if (!object) throw new Error(`Uploaded attachment not found in R2: ${key}`);
      fileUris.push({
        uri: `r2://${key}`,
        mimeType:
          object.mimeType ??
          (key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
      });
    }
    for (const url of inputs.googleDocUrls) {
      const document = await callSourceTool(deps, "google_drive", "Reading a Google document", () =>
        deps.exportGoogleDocument(url),
      );
      sources.push({ url, title: document.title });
      const root = document.nodes.find((node) => node.parentPath === null)?.path ?? document.title;
      const occurrence = (googleRootOccurrences.get(root) ?? 0) + 1;
      googleRootOccurrences.set(root, occurrence);
      const nodes = mountGoogleDocumentNodes(
        url,
        document.nodes,
        occurrence === 1 ? root : `${root} (${occurrence})`,
      );
      workspaceNodes.push(...nodes);
      googleNodeContents.push(
        ...nodes.flatMap((node) => (node.content === undefined ? [] : [node.content])),
      );
    }
    if (inputs.googleFormUrl) {
      const form = await callSourceTool(deps, "google_forms", "Reading a Google Form", () =>
        deps.exportGoogleForm(inputs.googleFormUrl as string, inputs.eventTitle),
      );
      const name = googleDocsPathSegment(form.title, "Google Form");
      workspaceNodes.push({
        path: `/google-forms/${name}`,
        parentPath: "/google-forms",
        title: form.title,
        kind: "google_form",
        content: form.text,
        sourceUrl: inputs.googleFormUrl,
      });
      sources.push({ url: inputs.googleFormUrl, title: `Google Form: ${form.title}` });
      skipClarification = true;
    }
  }

  if (resume?.selectedUrls) {
    for (const url of resume.selectedUrls.slice(0, 5)) {
      const result = await callSourceTool(deps, "web_fetch", "Fetching a selected web page", () =>
        deps.fetchWebPage(url),
      );
      if (result.error !== undefined) {
        warnings.push(`${url}: ${result.error}`);
        sources.push({ url, title: url });
        continue;
      }
      const content = result.markdown ?? "";
      const location = websiteWorkspacePath(url);
      const heading = content.match(/^(?:Title:\s*(.+)|#\s+(.+))/m);
      const title = (heading?.[1] ?? heading?.[2])?.trim() || location.title;
      workspaceNodes.push({
        path: location.path,
        parentPath: location.parentPath,
        title,
        kind: "website",
        content,
        sourceUrl: location.canonicalUrl,
      });
      sources.push({ url: location.canonicalUrl, title });
    }
  }

  if (workspaceNodes.length > 0) await deps.persistWorkspaceNodes(workspaceNodes);
  return {
    userInput,
    ...(resume?.clarificationAnswers ? { clarificationAnswers: resume.clarificationAnswers } : {}),
    fileUris,
    warnings,
    sources,
    skipClarification,
    isPostClarification: Boolean(resume?.clarificationAnswers),
    urlCandidates: resume ? [] : collectUrls(userInput, googleNodeContents, deps),
  };
}
