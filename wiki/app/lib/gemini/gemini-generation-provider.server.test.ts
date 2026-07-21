import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPhase0Clarifier } from "../gemini.server";
import { GeminiGenerationProvider } from "./gemini-generation-provider.server";

vi.mock("../gemini.server", () => ({
  runPdfConverter: vi.fn(),
  runPhase0Clarifier: vi.fn(),
  runPhase1Planner: vi.fn(),
  runPhase2Creator: vi.fn(),
  runPhase2Patcher: vi.fn(),
  runTranslation: vi.fn(),
}));

const clarifyInput = {
  userText: "source",
  files: [],
  currentDatetime: "2026-07-21",
};

describe("GeminiGenerationProvider structured output repair", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a valid structured response without repair", async () => {
    vi.mocked(runPhase0Clarifier).mockResolvedValue({
      needsClarification: false,
      questions: [],
      summary: "enough",
    });
    const provider = new GeminiGenerationProvider("test-key");

    await expect(provider.clarify(clarifyInput)).resolves.toMatchObject({
      needsClarification: false,
    });
    expect(runPhase0Clarifier).toHaveBeenCalledTimes(1);
  });

  it("repairs a validation failure exactly once with feedback", async () => {
    vi.mocked(runPhase0Clarifier)
      .mockRejectedValueOnce(new SyntaxError("invalid JSON"))
      .mockResolvedValueOnce({ needsClarification: false, questions: [], summary: "fixed" });
    const provider = new GeminiGenerationProvider("test-key");

    await expect(provider.clarify(clarifyInput)).resolves.toMatchObject({ summary: "fixed" });
    expect(runPhase0Clarifier).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runPhase0Clarifier).mock.calls[1]?.[4]).toContain("invalid JSON");
  });

  it("does not start a second repair after the repair response is invalid", async () => {
    vi.mocked(runPhase0Clarifier)
      .mockRejectedValueOnce(new SyntaxError("first invalid JSON"))
      .mockRejectedValueOnce(new SyntaxError("second invalid JSON"));
    const provider = new GeminiGenerationProvider("test-key");

    await expect(provider.clarify(clarifyInput)).rejects.toThrow("second invalid JSON");
    expect(runPhase0Clarifier).toHaveBeenCalledTimes(2);
  });
});
