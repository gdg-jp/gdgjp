import { describe, expect, it } from "vitest";
import { getWikiGenerationProviderOptions } from "./index.server";

describe("getWikiGenerationProviderOptions", () => {
  const directGemini = { GEMINI_API_KEY: "gemini-test-key" };

  it("keeps local and test generation on direct Gemini when Gateway is not configured", () => {
    expect(getWikiGenerationProviderOptions(directGemini)).toEqual({
      apiKey: "gemini-test-key",
    });
  });

  it("routes configured ingestion generation through an authenticated AI Gateway", () => {
    expect(
      getWikiGenerationProviderOptions({
        ...directGemini,
        AI_GATEWAY_BASE_URL:
          " https://gateway.ai.cloudflare.com/v1/account/gdgjp-wiki-generation/google-ai-studio/ ",
        AI_GATEWAY_TOKEN: " gateway-token ",
      }),
    ).toEqual({
      apiKey: "gemini-test-key",
      baseURL:
        "https://gateway.ai.cloudflare.com/v1/account/gdgjp-wiki-generation/google-ai-studio/",
      headers: {
        "cf-aig-authorization": "Bearer gateway-token",
      },
    });
  });

  it("falls back to direct Gemini for a partial non-production Gateway configuration", () => {
    expect(
      getWikiGenerationProviderOptions({
        ...directGemini,
        AI_GATEWAY_BASE_URL:
          "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio",
        ENVIRONMENT: "development",
      }),
    ).toEqual({ apiKey: "gemini-test-key" });
  });

  it("fails closed in production when the Gateway URL or token is missing", () => {
    expect(() =>
      getWikiGenerationProviderOptions({ ...directGemini, ENVIRONMENT: "production" }),
    ).toThrow("AI_GATEWAY_BASE_URL, AI_GATEWAY_TOKEN");

    expect(() =>
      getWikiGenerationProviderOptions({
        ...directGemini,
        ENVIRONMENT: "production",
        AI_GATEWAY_BASE_URL:
          "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio",
      }),
    ).toThrow("AI_GATEWAY_TOKEN");
  });
});
