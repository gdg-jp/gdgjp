/**
 * Gemini API client for the AI ingestion pipeline.
 *
 * All generation uses gemini-3-flash-preview with structured JSON output
 * enforced via responseJsonSchema. Schemas are written as plain JSON Schema
 * objects (not converted from Zod) to stay within Gemini's nesting depth limit.
 * Zod schemas are still used for post-parse validation and TypeScript types.
 */

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { pushFilePartsWithHint } from "./gemini/parts";
import {
  PDF_CONVERTER_SYSTEM_PROMPT,
  PHASE0_SYSTEM_PROMPT,
  PHASE1_SYSTEM_PROMPT,
  PHASE2_SYSTEM_PROMPT,
} from "./gemini/prompts";
import {
  OPERATION_PLAN_RESPONSE_SCHEMA,
  PAGE_DRAFT_RESPONSE_SCHEMA,
  PHASE0_RESPONSE_SCHEMA,
  SECTION_PATCH_RESPONSE_SCHEMA,
  TRANSLATION_RESPONSE_SCHEMA,
} from "./gemini/response-schemas";
import {
  type ClarificationQuestion,
  type ClarificationResult,
  ClarificationResultSchema,
  type CreateOperation,
  type OperationPlan,
  OperationPlanSchema,
  type PageDraft,
  PageDraftSchema,
  type PageIndexEntry,
  type SectionPatchResponse,
  SectionPatchResponseSchema,
  type SensitiveItem,
  type UpdateOperation,
} from "./gemini/types";
import { buildFeedbackSuffix, formatPageIndexAsTree } from "./gemini/utils";

export {
  ClarificationResultSchema,
  OperationPlanSchema,
  PageDraftSchema,
  SectionPatchResponseSchema,
};

export type {
  ClarificationQuestion,
  ClarificationResult,
  CreateOperation,
  OperationPlan,
  PageDraft,
  PageIndexEntry,
  SectionPatchResponse,
  SensitiveItem,
  UpdateOperation,
};

export { buildFeedbackSuffix, formatPageIndexAsTree };

// ---------------------------------------------------------------------------
// File upload helper (REST — works in Cloudflare Workers)
// ---------------------------------------------------------------------------

const MULTIPART_LIMIT = 5 * 1024 * 1024; // 5MB

async function pollUntilActive(fileResourceName: string, apiKey: string): Promise<void> {
  const getUrl = `https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`;
  const deadline = Date.now() + 60_000;
  let waitMs = 2_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitMs));
    waitMs = Math.min(waitMs * 2, 10_000);

    const poll = await fetch(getUrl);
    if (!poll.ok) {
      console.warn(
        `gemini: poll non-ok for ${fileResourceName}: ${poll.status} ${poll.statusText}`,
      );
      continue;
    }

    const status = (await poll.json()) as { state?: string; uri?: string };
    if (status.state === "ACTIVE") return;
    if (status.state === "FAILED") {
      throw new Error(`Gemini file processing failed: ${fileResourceName}`);
    }
  }
}

async function uploadMultipart(
  fileBytes: Uint8Array,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<string> {
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

  const boundary = `boundary-${Date.now()}`;
  const metadata = JSON.stringify({ file: { display_name: displayName, mime_type: mimeType } });

  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const endBoundary = `\r\n--${boundary}--`;

  const metadataBytes = new TextEncoder().encode(metadataPart);
  const filePartBytes = new TextEncoder().encode(filePart);
  const endBytes = new TextEncoder().encode(endBoundary);

  const body = new Uint8Array(
    metadataBytes.byteLength +
      filePartBytes.byteLength +
      fileBytes.byteLength +
      endBytes.byteLength,
  );
  let offset = 0;
  body.set(metadataBytes, offset);
  offset += metadataBytes.byteLength;
  body.set(filePartBytes, offset);
  offset += filePartBytes.byteLength;
  body.set(fileBytes, offset);
  offset += fileBytes.byteLength;
  body.set(endBytes, offset);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini file upload failed: ${response.status} ${err}`);
  }

  const result = (await response.json()) as { file: { name: string; uri: string; state?: string } };
  const file = result.file;

  if (file.state && file.state !== "ACTIVE") {
    await pollUntilActive(file.name, apiKey);
  }

  return file.uri;
}

async function uploadResumable(
  fileBytes: Uint8Array,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<string> {
  const initiateUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${apiKey}`;

  // Step 1: initiate session
  const initiateRes = await fetch(initiateUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileBytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });

  if (!initiateRes.ok) {
    const err = await initiateRes.text();
    throw new Error(`Gemini resumable upload initiation failed: ${initiateRes.status} ${err}`);
  }

  const sessionUri = initiateRes.headers.get("X-Goog-Upload-URL");
  if (!sessionUri) {
    throw new Error("Gemini resumable upload: missing X-Goog-Upload-URL in response");
  }

  // Step 2: upload file bytes
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);
  let uploadRes: Response;
  try {
    uploadRes = await fetch(sessionUri, {
      method: "POST",
      headers: {
        "Content-Length": String(fileBytes.byteLength),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: fileBytes.buffer as ArrayBuffer,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Gemini resumable upload failed: ${uploadRes.status} ${err}`);
  }

  const result = (await uploadRes.json()) as {
    file: { name: string; uri: string; state?: string };
  };
  const file = result.file;

  if (file.state && file.state !== "ACTIVE") {
    await pollUntilActive(file.name, apiKey);
  }

  return file.uri;
}

export async function uploadFileToGemini(
  buffer: ArrayBuffer,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<string> {
  const fileBytes = new Uint8Array(buffer);

  if (fileBytes.byteLength < MULTIPART_LIMIT) {
    return uploadMultipart(fileBytes, mimeType, displayName, apiKey);
  }
  return uploadResumable(fileBytes, mimeType, displayName, apiKey);
}

// ---------------------------------------------------------------------------
// PDF Converter (sub-agent for URL-fetched PDFs)
// ---------------------------------------------------------------------------
export async function runPdfConverter(
  apiKey: string,
  fileUri: string,
  sourceUrl: string,
): Promise<string> {
  console.log("[runPdfConverter] start — fileUri:", fileUri, "source:", sourceUrl);
  const ai = new GoogleGenAI({ apiKey });
  const parts = [
    { fileData: { mimeType: "application/pdf", fileUri } },
    {
      text: `Convert the above PDF (source URL: ${sourceUrl}) to Markdown, preserving all information.`,
    },
  ];
  console.log("[runPdfConverter] calling Gemini model: gemini-3-flash-preview");
  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts }],
      config: { systemInstruction: PDF_CONVERTER_SYSTEM_PROMPT },
    });
  } catch (err) {
    console.error("[runPdfConverter] Gemini API error:", err);
    throw err;
  }
  console.log(
    "[runPdfConverter] response received — text length:",
    response.text?.length ?? 0,
    "finishReason:",
    response.candidates?.[0]?.finishReason,
  );
  if (!response.text) throw new Error("Empty response from PDF converter");
  return response.text;
}

// ---------------------------------------------------------------------------
// Phase 0: Clarifier
// ---------------------------------------------------------------------------
export async function runPhase0Clarifier(
  apiKey: string,
  userText: string,
  fileUris: { uri: string; mimeType: string }[],
  currentDatetime: string,
): Promise<ClarificationResult> {
  const ai = new GoogleGenAI({ apiKey });

  const parts = [
    { text: `## ユーザー入力\n\n${userText}\n\n## 現在の日時（参考情報）\n${currentDatetime}` },
  ] as Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } }>;
  pushFilePartsWithHint(parts, fileUris);
  parts.push({
    text: "\n\n---\n上記の入力を分析し、高品質なWikiページを作成するために必要な情報が十分かどうか判断してください。",
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: PHASE0_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: PHASE0_RESPONSE_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Empty response from model in runPhase0Clarifier");
  const json = JSON.parse(response.text);
  return ClarificationResultSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Phase 1: Operation Planner
// ---------------------------------------------------------------------------
export async function runPhase1Planner(
  apiKey: string,
  userText: string,
  fileUris: { uri: string; mimeType: string }[],
  pageIndex: PageIndexEntry[],
  currentDatetime: string,
): Promise<OperationPlan> {
  const ai = new GoogleGenAI({ apiKey });

  const parts = [
    {
      text: `## ユーザー入力\n\n### テキスト\n${userText}\n\n## 現在の日時（参考情報）\n${currentDatetime}`,
    },
  ] as Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } }>;
  pushFilePartsWithHint(parts, fileUris);
  parts.push({
    text: `\n\n## 既存Wikiページ一覧（最大200件、ツリー形式）\n${formatPageIndexAsTree(pageIndex)}\n※ FTS5で関連性の高いページを上位に並べ替え済み\n※ [id:xxx] の値をsuggestedParentIdに使用できます\n\n---\n上記をもとに、OperationPlan JSONを出力してください。`,
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: PHASE1_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: OPERATION_PLAN_RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  if (!response.text) throw new Error("Empty response from model in runPhase1Planner");
  const json = JSON.parse(response.text);
  return OperationPlanSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Phase 2a: Creator
// ---------------------------------------------------------------------------
export async function runPhase2Creator(
  apiKey: string,
  userText: string,
  fileUris: { uri: string; mimeType: string }[],
  op: CreateOperation,
  pageIndex: PageIndexEntry[],
  siblingOps: CreateOperation[],
  currentDatetime: string,
  imageNames?: string[],
): Promise<PageDraft> {
  const ai = new GoogleGenAI({ apiKey });

  const parts = [
    {
      text: `## ユーザー入力\n\n### テキスト\n${userText}\n\n## 現在の日時（参考情報）\n${currentDatetime}`,
    },
  ] as Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } }>;
  pushFilePartsWithHint(parts, fileUris);
  if (imageNames && imageNames.length > 0) {
    parts.push({
      text: `\n\n## 添付画像（参照可能）\n以下の画像が添付されています。本文の内容と関連がある場合のみ、Markdown画像記法で挿入してください:\n${imageNames.map((n) => `- img:${n}`).join("\n")}\n挿入形式: ![説明文](img:filename.ext)\n関連がない場合は画像を含めなくて構いません。`,
    });
  }
  const siblingContext =
    siblingOps.length > 0
      ? `\n\n## 同時に生成される他のページ（内容の重複を避けてください）\n${JSON.stringify(siblingOps.map((s) => ({ tempId: s.tempId, title: s.suggestedTitle.ja, pageType: s.pageType })))}\n\nあなたが担当するページ: "${op.suggestedTitle.ja}"\n上記の他ページと内容が重複しないようにしてください。`
      : "";
  parts.push({
    text: `\n\n## 操作計画\n${JSON.stringify(op)}\n\n## 既存Wikiページ構造（親ページ候補選定用、ツリー形式）\n${formatPageIndexAsTree(pageIndex.slice(0, 50))}${siblingContext}\n\n---\n上記のユーザー入力に含まれる情報のみを使用して、PageDraft JSONを出力してください。\n入力に存在しないコンテキスト・手順・前提条件を追加しないでください。\n入力が短い場合は、出力も短くしてください。`,
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: PHASE2_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: PAGE_DRAFT_RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  if (!response.text) throw new Error("Empty response from model in runPhase2Creator");
  const json = JSON.parse(response.text);
  return PageDraftSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Phase 2b: Patcher
// ---------------------------------------------------------------------------
export async function runPhase2Patcher(
  apiKey: string,
  userText: string,
  fileUris: { uri: string; mimeType: string }[],
  op: UpdateOperation,
  existingMarkdown: string,
  currentDatetime: string,
  imageNames?: string[],
): Promise<SectionPatchResponse> {
  const ai = new GoogleGenAI({ apiKey });

  const parts = [
    {
      text: `## ユーザー入力\n\n### テキスト\n${userText}\n\n## 現在の日時（参考情報）\n${currentDatetime}`,
    },
  ] as Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } }>;
  pushFilePartsWithHint(parts, fileUris);
  if (imageNames && imageNames.length > 0) {
    parts.push({
      text: `\n\n## 添付画像（参照可能）\n以下の画像が添付されています。本文の内容と関連がある場合のみ、Markdown画像記法で挿入してください:\n${imageNames.map((n) => `- img:${n}`).join("\n")}\n挿入形式: ![説明文](img:filename.ext)\n関連がない場合は画像を含めなくて構いません。`,
    });
  }
  parts.push({
    text: `\n\n## 更新対象ページの現在の内容（Markdown変換済み）\n# ${op.pageTitle}\n${existingMarkdown}\n\n## 操作計画\n${JSON.stringify(op)}\n\n---\n既存ページの構造・文体・見出しレベルに従い、SectionPatch JSONを出力してください。\n既存のコンテンツは削除・置換せず、追記のみ行ってください。`,
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: PHASE2_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseJsonSchema: SECTION_PATCH_RESPONSE_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Empty response from model in runPhase2Patcher");
  const json = JSON.parse(response.text);
  json.pageId = json.pageId ?? op.pageId;
  return SectionPatchResponseSchema.parse(json);
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------
export async function runTranslation(
  apiKey: string,
  contentJa: string,
  titleJa: string,
  summaryJa: string,
): Promise<{ contentEn: string; titleEn: string; summaryEn: string }> {
  const ai = new GoogleGenAI({ apiKey });

  const TranslationSchema = z.object({
    titleEn: z.string().min(1),
    summaryEn: z.string(),
    contentEn: z.string().min(1),
  });

  const prompt = `Translate the following Japanese wiki page content to English.
The content is in TipTap/ProseMirror JSON format. Translate ONLY the values of "text" properties within the JSON nodes, preserving the complete JSON structure — all "type", "attrs", "marks", and "content" fields must remain exactly as-is.
Return the complete TipTap JSON with Japanese text replaced by English translations. Do not add or remove nodes.

Title (Japanese): ${titleJa}
Summary (Japanese): ${summaryJa}

Content (TipTap JSON):
${contentJa}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: TRANSLATION_RESPONSE_SCHEMA,
    },
  });

  if (!response.text) throw new Error("Empty response from model in runTranslation");
  const json = JSON.parse(response.text);
  const parsed = TranslationSchema.safeParse(json);
  if (!parsed.success) {
    console.error("Translation schema validation failed:", parsed.error);
    throw new Error("Translation output failed validation");
  }
  return {
    titleEn: parsed.data.titleEn,
    summaryEn: parsed.data.summaryEn,
    contentEn: parsed.data.contentEn,
  };
}
