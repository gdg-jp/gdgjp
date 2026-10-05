import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("embed HF_HOME bridging", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets env.cacheDir from HF_HOME when present", async () => {
    vi.stubEnv("HF_HOME", "/var/lib/agents-index/hf");
    await import("../src/indexer/embed.ts");
    const { env } = await import("@huggingface/transformers");
    expect(env.cacheDir).toBe("/var/lib/agents-index/hf");
  });

  it("leaves env.cacheDir untouched when HF_HOME is unset", async () => {
    vi.stubEnv("HF_HOME", undefined);
    const { env: envBefore } = await import("@huggingface/transformers");
    const defaultCacheDir = envBefore.cacheDir;
    vi.resetModules();
    await import("../src/indexer/embed.ts");
    const { env: envAfter } = await import("@huggingface/transformers");
    expect(envAfter.cacheDir).toBe(defaultCacheDir);
  });
});
