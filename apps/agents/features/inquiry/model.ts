import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModelV3 } from "@ai-sdk/provider";
export type AgentEnv = {
  WIKI_API_URL: string;
  WIKI_PUBLIC_URL?: string;
  CONNPASS_API_URL?: string;
  ACCOUNTS_URL: string;
  GOOGLE_VERTEX_API_KEY?: string;
  AGENT_MODEL?: string;
};

export function defaultEnv(env: NodeJS.ProcessEnv = process.env): AgentEnv {
  return {
    WIKI_API_URL: env.WIKI_API_URL ?? "https://wiki.gdgs.jp",
    WIKI_PUBLIC_URL: env.WIKI_PUBLIC_URL,
    CONNPASS_API_URL: env.CONNPASS_API_URL ?? "https://connpass.gdgs.jp",
    ACCOUNTS_URL: env.ACCOUNTS_URL ?? "https://accounts.gdgs.jp",
    GOOGLE_VERTEX_API_KEY: env.GOOGLE_VERTEX_API_KEY,
    AGENT_MODEL: env.AGENT_MODEL,
  };
}

export function defaultAgentModel(env: AgentEnv = defaultEnv()): LanguageModelV3 {
  const apiKey = env.GOOGLE_VERTEX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_VERTEX_API_KEY is required to use the Vertex AI Gemini provider");
  }

  const modelId = env.AGENT_MODEL?.trim() || "gemini-2.5-flash";
  return createVertex({ apiKey })(modelId);
}
