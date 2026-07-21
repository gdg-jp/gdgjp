import {
  type LanguageModel,
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

function failureMetadata(error: NoObjectGeneratedError) {
  return {
    finishReason: error.finishReason,
    cause: error.cause instanceof Error ? error.cause.name : "unknown",
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
  const generate = (messages: ModelMessage[]) =>
    generateText({
      model: request.model,
      system: request.system,
      messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: request.maxRetries,
      output,
    });

  try {
    const result = await generate(request.messages);
    return result.output as z.infer<TSchema>;
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error) || !error.text?.trim()) throw error;

    console.warn("Structured output did not match schema; retrying once", {
      schemaName: request.schemaName,
      ...failureMetadata(error),
    });
    try {
      const repaired = await generate(repairMessages(request.messages, error.text));
      return repaired.output as z.infer<TSchema>;
    } catch (repairError) {
      if (NoObjectGeneratedError.isInstance(repairError)) {
        console.error("Structured output repair failed", {
          schemaName: request.schemaName,
          ...failureMetadata(repairError),
        });
      }
      throw repairError;
    }
  }
}
