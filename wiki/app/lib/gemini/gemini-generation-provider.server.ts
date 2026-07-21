import { GoogleGenAI } from "@google/genai";
import {
  runPdfConverter,
  runPhase0Clarifier,
  runPhase1Planner,
  runPhase2Creator,
  runPhase2Patcher,
  runTranslation,
} from "../gemini.server";
import type {
  ClarifyGenerationInput,
  CreateGenerationInput,
  GenerationProvider,
  PatchGenerationInput,
  PdfConversionInput,
  PlanGenerationInput,
  SearchAnswerInput,
  TokenCount,
  TokenCountInput,
  TranslationGenerationInput,
} from "./generation-provider";
import { GEMINI_MODEL, PROMPT_VERSIONS, SEARCH_ANSWER_SYSTEM_PROMPT } from "./prompts";

const MAX_TRANSIENT_RETRIES = 3;

function isStructuredOutputError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    ("issues" in error ||
      ("message" in error && /schema|validation|json/i.test(String(error.message))))
  );
}

function validationFeedback(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function isTransientGenerationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  const status = Number(record.status ?? record.statusCode ?? record.code);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|\b5\d\d\b|timed?\s*out|timeout|deadline exceeded/i.test(message);
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientGenerationError(error) || retries >= MAX_TRANSIENT_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** retries));
      retries++;
    }
  }
}

async function withSingleStructuredRepair<T>(
  operation: (repairFeedback?: string) => Promise<T>,
): Promise<T> {
  try {
    return await withTransientRetry(() => operation());
  } catch (error) {
    if (!isStructuredOutputError(error)) throw error;
    return withTransientRetry(() => operation(validationFeedback(error)));
  }
}

/**
 * Gemini adapter for the model-neutral generation contract.
 *
 * The legacy helpers remain the single implementation while existing callers
 * migrate incrementally to this provider.
 */
export class GeminiGenerationProvider implements GenerationProvider {
  readonly model: string;
  readonly promptVersions = PROMPT_VERSIONS;

  constructor(
    private readonly apiKey: string,
    model = GEMINI_MODEL,
  ) {
    this.model = model;
  }

  clarify(input: ClarifyGenerationInput) {
    return withSingleStructuredRepair((feedback) =>
      runPhase0Clarifier(this.apiKey, input.userText, input.files, input.currentDatetime, feedback),
    );
  }

  plan(input: PlanGenerationInput) {
    return withSingleStructuredRepair((feedback) =>
      runPhase1Planner(
        this.apiKey,
        input.userText,
        input.files,
        input.pageIndex,
        input.currentDatetime,
        feedback,
      ),
    );
  }

  create(input: CreateGenerationInput) {
    return withSingleStructuredRepair((feedback) =>
      runPhase2Creator(
        this.apiKey,
        input.userText,
        input.files,
        input.operation,
        input.pageIndex,
        input.siblingOperations,
        input.currentDatetime,
        input.imageNames,
        feedback,
      ),
    );
  }

  patch(input: PatchGenerationInput) {
    return withSingleStructuredRepair((feedback) =>
      runPhase2Patcher(
        this.apiKey,
        input.userText,
        input.files,
        input.operation,
        input.existingMarkdown,
        input.currentDatetime,
        input.imageNames,
        feedback,
      ),
    );
  }

  translate(input: TranslationGenerationInput) {
    return withSingleStructuredRepair((feedback) =>
      runTranslation(this.apiKey, input.contentJa, input.titleJa, input.summaryJa, feedback),
    );
  }

  convertPdf(input: PdfConversionInput) {
    return withTransientRetry(() => runPdfConverter(this.apiKey, input.fileUri, input.sourceUrl));
  }

  async answerSearch(input: SearchAnswerInput): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const evidence = input.evidence
      .map((item) => `[Page: ${item.title}] (slug: ${item.slug})\n${item.chunks.join("\n\n")}`)
      .join("\n\n---\n\n");
    const response = await withTransientRetry(() =>
      ai.models.generateContent({
        model: this.model,
        contents: `## Access-controlled evidence\n\n${evidence}\n\n## Question\n${input.query}`,
        config: { systemInstruction: SEARCH_ANSWER_SYSTEM_PROMPT, temperature: 0.3 },
      }),
    );
    return response.text ?? "";
  }

  async countTokens(input: TokenCountInput): Promise<TokenCount> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const response = await withTransientRetry(() =>
      ai.models.countTokens({
        model: input.model ?? this.model,
        contents: input.contents,
        config: input.systemInstruction
          ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
          : undefined,
      }),
    );
    if (response.totalTokens === undefined) {
      throw new Error("Gemini did not return a token count");
    }
    return { inputTokens: response.totalTokens, model: input.model ?? this.model };
  }
}

export function createGeminiGenerationProvider(apiKey: string): GeminiGenerationProvider {
  return new GeminiGenerationProvider(apiKey);
}
