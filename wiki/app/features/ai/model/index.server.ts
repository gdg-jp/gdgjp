import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { type LanguageModel, type ModelMessage, Output, generateText } from "ai";
import type { z } from "zod";

/**
 * Provider-neutral boundary for every non-agent model call in the Wiki app.
 *
 * Feature code depends on this small contract instead of a provider SDK. New
 * providers only need another factory that supplies a LanguageModel.
 */
export interface TextGenerationRequest {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
}

export interface StructuredGenerationRequest<TSchema extends z.ZodType>
  extends TextGenerationRequest {
  schema: TSchema;
  schemaName: string;
  schemaDescription?: string;
}

export interface WikiModel {
  readonly id: string;
  generateText(request: TextGenerationRequest): Promise<string>;
  generateObject<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<z.infer<TSchema>>;
}

export interface WikiModelOptions {
  apiKey: string;
  /** Defaults to the existing production model so the public behavior is unchanged. */
  modelId?: string;
}

class AiSdkWikiModel implements WikiModel {
  constructor(
    readonly id: string,
    private readonly model: LanguageModel,
  ) {}

  async generateText(request: TextGenerationRequest): Promise<string> {
    const result = await generateText(
      request.messages
        ? {
            model: this.model,
            system: request.system,
            messages: request.messages,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: request.maxRetries,
          }
        : {
            model: this.model,
            system: request.system,
            prompt: request.prompt ?? "",
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: request.maxRetries,
          },
    );
    return result.text;
  }

  async generateObject<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const output = Output.object({
      name: request.schemaName,
      description: request.schemaDescription,
      schema: request.schema,
    });
    const result = await generateText(
      request.messages
        ? {
            model: this.model,
            system: request.system,
            messages: request.messages,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: request.maxRetries,
            output,
          }
        : {
            model: this.model,
            system: request.system,
            prompt: request.prompt ?? "",
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: request.maxRetries,
            output,
          },
    );
    return result.output as z.infer<TSchema>;
  }
}

/**
 * The initial implementation is Gemini through AI SDK v6. Nothing outside
 * this module depends on @ai-sdk/google, so replacing the provider is local.
 */
export function createWikiModel(options: WikiModelOptions): WikiModel {
  const modelId = options.modelId ?? "gemini-3.1-flash-lite";
  return new AiSdkWikiModel(modelId, createWikiLanguageModel(options));
}

/** Used by agentic features that need AI SDK's native tools/step loop. */
export function createWikiLanguageModel(options: WikiModelOptions): LanguageModel {
  const provider = createGoogleGenerativeAI({ apiKey: options.apiKey });
  return provider(options.modelId ?? "gemini-3.1-flash-lite");
}

type ModelEnvironment = { GEMINI_MODEL_ID?: string };

export function getWikiModelId(env: ModelEnvironment): string {
  return env.GEMINI_MODEL_ID?.trim() || "gemini-3.1-flash-lite";
}

export function createWikiModelFromEnv(
  env: Pick<Env, "GEMINI_API_KEY"> & ModelEnvironment,
): WikiModel {
  return createWikiModel({
    apiKey: env.GEMINI_API_KEY,
    modelId: getWikiModelId(env),
  });
}

export function createWikiLanguageModelFromEnv(
  env: Pick<Env, "GEMINI_API_KEY"> & ModelEnvironment,
): LanguageModel {
  return createWikiLanguageModel({
    apiKey: env.GEMINI_API_KEY,
    modelId: getWikiModelId(env),
  });
}
