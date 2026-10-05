import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { type LanguageModel, type ModelMessage, generateText } from "ai";
import type { z } from "zod";
import {
  type StructuredOutputTelemetry,
  generateValidatedObject,
} from "./structured-output.server";

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
  headers?: Record<string, string>;
}

export interface StructuredGenerationRequest<TSchema extends z.ZodType>
  extends TextGenerationRequest {
  schema: TSchema;
  schemaName: string;
  schemaDescription?: string;
  telemetry?: StructuredOutputTelemetry;
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

/**
 * The subset of Worker bindings used by the ingestion-only model factories.
 *
 * Keep this structurally typed rather than referring to generated `Env` keys so
 * the runtime guard remains usable before `wrangler types` has been refreshed.
 */
export interface WikiGenerationModelEnvironment {
  GEMINI_API_KEY: string;
  GEMINI_MODEL_ID?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  ENVIRONMENT?: string;
}

export interface WikiGenerationProviderOptions {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
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
            headers: request.headers,
          }
        : {
            model: this.model,
            system: request.system,
            prompt: request.prompt ?? "",
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            maxRetries: request.maxRetries,
            headers: request.headers,
          },
    );
    return result.text;
  }

  async generateObject<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    return generateValidatedObject({
      model: this.model,
      schema: request.schema,
      schemaName: request.schemaName,
      schemaDescription: request.schemaDescription,
      system: request.system,
      messages: request.messages ?? [{ role: "user", content: request.prompt ?? "" }],
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: request.maxRetries,
      headers: request.headers,
      telemetry: request.telemetry,
    });
  }
}

/**
 * The initial implementation is Gemini through AI SDK v6. Nothing outside
 * this module depends on @ai-sdk/google, so replacing the provider is local.
 */
export function createWikiModel(options: WikiModelOptions): WikiModel {
  const modelId = options.modelId ?? "gemini-3.5-flash-lite";
  return new AiSdkWikiModel(modelId, createWikiLanguageModel(options));
}

/** Used by agentic features that need AI SDK's native tools/step loop. */
export function createWikiLanguageModel(options: WikiModelOptions): LanguageModel {
  const provider = createGoogleGenerativeAI({ apiKey: options.apiKey });
  return provider(options.modelId ?? "gemini-3.5-flash-lite");
}

type ModelEnvironment = { GEMINI_MODEL_ID?: string };

export function getWikiModelId(env: ModelEnvironment): string {
  return env.GEMINI_MODEL_ID?.trim() || "gemini-3.5-flash-lite";
}

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isProductionEnvironment(
  env: Pick<WikiGenerationModelEnvironment, "ENVIRONMENT">,
): boolean {
  return configuredValue(env.ENVIRONMENT)?.toLowerCase() === "production";
}

/**
 * Resolves the Google AI SDK provider configuration for ingestion generation.
 *
 * Direct Gemini remains available outside production so local development and
 * tests do not require Cloudflare credentials. Production intentionally fails
 * closed: an authenticated gateway is the required observability boundary.
 */
export function getWikiGenerationProviderOptions(
  env: WikiGenerationModelEnvironment,
): WikiGenerationProviderOptions {
  const baseURL = configuredValue(env.AI_GATEWAY_BASE_URL);
  const gatewayToken = configuredValue(env.AI_GATEWAY_TOKEN);

  if (isProductionEnvironment(env) && (!baseURL || !gatewayToken)) {
    const missing = [
      !baseURL ? "AI_GATEWAY_BASE_URL" : undefined,
      !gatewayToken ? "AI_GATEWAY_TOKEN" : undefined,
    ].filter((value): value is string => value !== undefined);
    throw new Error(
      `Wiki generation requires an authenticated AI Gateway in production. Missing: ${missing.join(", ")}.`,
    );
  }

  // A partial local/test gateway configuration is not useful for an
  // authenticated gateway. Fall back to the current direct Gemini behavior.
  if (!baseURL || !gatewayToken) return { apiKey: env.GEMINI_API_KEY };

  return {
    apiKey: env.GEMINI_API_KEY,
    baseURL,
    headers: {
      "cf-aig-authorization": `Bearer ${gatewayToken}`,
    },
  };
}

export function createWikiModelFromEnv(env: WikiGenerationModelEnvironment): WikiModel {
  const modelId = getWikiModelId(env);
  return new AiSdkWikiModel(modelId, createWikiLanguageModelFromEnv(env));
}

export function createWikiLanguageModelFromEnv(env: WikiGenerationModelEnvironment): LanguageModel {
  const provider = createGoogleGenerativeAI(getWikiGenerationProviderOptions(env));
  return provider(getWikiModelId(env));
}
