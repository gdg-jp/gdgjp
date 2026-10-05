import {
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
  generateText,
} from "ai";
import type { z } from "zod";

const MAX_REPAIR_CANDIDATE_CHARS = 24_000;

export interface ValidatedObjectRequest<TSchema extends z.ZodType> {
  model: LanguageModel;
  schema: TSchema;
  schemaName: string;
  schemaDescription?: string;
  system?: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  telemetry?: StructuredOutputTelemetry;
}

export type StructuredOutputStage = "structured" | "repair";

export interface StructuredOutputAttempt {
  modelCallId: string;
  headers?: Record<string, string>;
}

export interface StructuredOutputAttemptResult {
  stage: StructuredOutputStage;
  modelCallId: string;
  outcome: "success" | "schema_mismatch" | "error";
  durationMs: number;
  finishReason?: string;
  usage?: LanguageModelUsage;
  responseModelId?: string;
  outputChars?: number;
  error?: unknown;
}

export interface StructuredOutputTelemetry {
  start(stage: StructuredOutputStage): StructuredOutputAttempt;
  finish(result: StructuredOutputAttemptResult): void;
}

function repairMessages(messages: ModelMessage[], invalidText: string): ModelMessage[] {
  const candidate = invalidText.slice(0, MAX_REPAIR_CANDIDATE_CHARS);
  const truncated = invalidText.length > candidate.length;
  return [
    ...messages,
    { role: "assistant", content: candidate },
    {
      role: "user",
      content: `直前の出力は JSON として解釈できましたが、要求されたスキーマに一致しませんでした。
元の一次資料と指示を再確認し、全ての必須フィールド、列挙値、null を含む型を厳密に守った
構造化出力をもう一度返してください。説明文や Markdown は付けないでください。${
        truncated
          ? " 直前の候補は長いため末尾を省略しています。一次資料を正として再生成してください。"
          : ""
      }`,
    },
  ];
}

function validationPaths(error: unknown): string[] {
  const paths = new Set<string>();
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        const path = (issue as { path?: unknown }).path;
        if (Array.isArray(path)) paths.add(path.length ? path.join(".") : "<root>");
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return [...paths].slice(0, 8);
}

function failureMetadata(error: NoObjectGeneratedError) {
  return {
    finishReason: error.finishReason,
    cause: error.cause instanceof Error ? error.cause.name : "unknown",
    validationPaths: validationPaths(error),
  };
}

/**
 * Generate and validate an object, with one bounded schema-repair attempt.
 *
 * Provider retries are deliberately separate: this only repairs a completed
 * response that is parseable but does not satisfy the application schema.
 */
export async function generateValidatedObject<TSchema extends z.ZodType>(
  request: ValidatedObjectRequest<TSchema>,
): Promise<z.infer<TSchema>> {
  const output = Output.object({
    name: request.schemaName,
    description: request.schemaDescription,
    schema: request.schema,
  });
  const generate = async (messages: ModelMessage[], stage: StructuredOutputStage) => {
    const fallbackAttempt: StructuredOutputAttempt = { modelCallId: crypto.randomUUID() };
    let attempt = fallbackAttempt;
    try {
      attempt = request.telemetry?.start(stage) ?? fallbackAttempt;
    } catch {
      // Telemetry setup must not block model execution.
    }
    const startedAt = Date.now();
    try {
      const result = await generateText({
        model: request.model,
        system: request.system,
        messages,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: request.maxRetries,
        headers:
          request.headers || attempt.headers
            ? { ...request.headers, ...attempt.headers }
            : undefined,
        output,
      });
      try {
        const value = result.output as z.infer<TSchema>;
        try {
          request.telemetry?.finish({
            stage,
            modelCallId: attempt.modelCallId,
            outcome: "success",
            durationMs: Date.now() - startedAt,
            finishReason: result.finishReason,
            usage: result.usage,
            responseModelId: result.response.modelId,
            outputChars: result.text.length,
          });
        } catch {
          // Telemetry failures are isolated from valid model output.
        }
        return value;
      } catch (error) {
        try {
          request.telemetry?.finish({
            stage,
            modelCallId: attempt.modelCallId,
            outcome: NoObjectGeneratedError.isInstance(error) ? "schema_mismatch" : "error",
            durationMs: Date.now() - startedAt,
            finishReason: result.finishReason,
            usage: result.usage,
            responseModelId: result.response.modelId,
            outputChars: result.text.length,
            error,
          });
        } catch {
          // Telemetry failures are isolated from schema handling.
        }
        throw error;
      }
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) {
        try {
          request.telemetry?.finish({
            stage,
            modelCallId: attempt.modelCallId,
            outcome: "error",
            durationMs: Date.now() - startedAt,
            error,
          });
        } catch {
          // Telemetry failures are isolated from provider failures.
        }
      }
      throw error;
    }
  };

  try {
    return await generate(request.messages, "structured");
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error) || !error.text?.trim()) throw error;

    console.warn("Structured output did not match schema; retrying once", {
      schemaName: request.schemaName,
      ...failureMetadata(error),
    });
    try {
      return await generate(repairMessages(request.messages, error.text), "repair");
    } catch (repairError) {
      if (NoObjectGeneratedError.isInstance(repairError)) {
        const metadata = failureMetadata(repairError);
        console.error("Structured output repair failed", {
          schemaName: request.schemaName,
          ...metadata,
        });
        throw new Error(
          `Structured output repair failed for ${request.schemaName} ` +
            `(finishReason=${metadata.finishReason ?? "unknown"}, ` +
            `validationPaths=${metadata.validationPaths.join(",") || "unknown"})`,
          { cause: repairError },
        );
      }
      throw repairError;
    }
  }
}
