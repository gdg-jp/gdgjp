import type {
  ClarificationQuestion,
  ClarificationResult,
  PageDraft,
  SectionPatchResponse,
  SensitiveItem,
} from "~/lib/gemini.server";
import type { ExtractedUrl } from "../url-extract";

export interface SourceUrl {
  url: string;
  title: string;
}

export interface IngestionInputs {
  texts: string[];
  imageKeys: string[];
  googleDocUrls: string[];
  imageFiles?: Array<{ key: string; buffer: ArrayBuffer; mimeType: string; name: string }>;
  pdfKeys?: string[];
  pdfFiles?: Array<{ key: string; buffer: ArrayBuffer; mimeType: string; name: string }>;
  googleFormUrl?: string;
  eventTitle?: string;
}

export interface ChangesetOperation {
  type: "create" | "update";
  tempId?: string;
  pageId?: string;
  pageTitle?: string;
  rationale: string;
  draft: PageDraft | null;
  patch: SectionPatchResponse | null;
  existingTipTapJson?: string;
}

export type { ClarificationQuestion, ClarificationResult };

export type AiDraftJson =
  | {
      phase: "clarification";
      questions: ClarificationQuestion[];
      summary: string;
      fileUris: { uri: string; mimeType: string }[];
      googleDocText?: string;
      sourceArtifactKey?: string;
      sources?: SourceUrl[];
    }
  | {
      phase: "url_selection";
      urls: ExtractedUrl[];
      fileUris: { uri: string; mimeType: string }[];
      googleDocText?: string;
      sourceArtifactKey?: string;
    }
  | {
      phase: "resume_post_clarification";
      fileUris: { uri: string; mimeType: string }[];
      clarificationAnswers: string;
      googleDocText?: string;
      sourceArtifactKey?: string;
      sources?: SourceUrl[];
    }
  | {
      phase: "resume_post_url_selection";
      fileUris: { uri: string; mimeType: string }[];
      selectedUrls: string[];
      googleDocText?: string;
      sourceArtifactKey?: string;
    }
  | {
      phase?: "result";
      planRationale: string;
      operations: ChangesetOperation[];
      sensitiveItems: SensitiveItem[];
      warnings: string[];
      sources: SourceUrl[];
      imageKeys: string[];
      pdfKeys: string[];
    };

export type IngestionResumePostClarificationDraft = Extract<
  AiDraftJson,
  { phase: "resume_post_clarification" }
>;

export type IngestionResumePostUrlSelectionDraft = Extract<
  AiDraftJson,
  { phase: "resume_post_url_selection" }
>;
