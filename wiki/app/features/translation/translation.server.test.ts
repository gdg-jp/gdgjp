import { describe, expect, it, vi } from "vitest";
import type { WikiModel } from "~/features/ai/model/index.server";
import { translatePage } from "./translation.server";

describe("translatePage", () => {
  it("uses a structured provider request and preserves the public result shape", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      titleEn: "Event report",
      summaryEn: "A short summary",
      contentEn: "# Event report\n\nA short summary.",
    });

    const result = await translatePage(
      {
        titleJa: "イベントレポート",
        summaryJa: "概要",
        contentJa: "# イベントレポート\n\n概要です。",
      },
      { id: "test", generateText: vi.fn(), generateObject } as WikiModel,
    );

    expect(result).toEqual({
      titleEn: "Event report",
      summaryEn: "A short summary",
      contentEn: "# Event report\n\nA short summary.",
    });
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaName: "wiki_translation",
        temperature: 0,
        prompt: expect.stringContaining("イベントレポート"),
      }),
    );
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Content (Markdown):"),
        schemaDescription: "The translated Wiki title, summary, and Markdown content.",
      }),
    );
  });

  it("instructs the model to preserve Markdown rather than return TipTap JSON", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      titleEn: "Guide",
      summaryEn: "Summary",
      contentEn: "## Setup\n\n![Logo](/images/logo.png)\n\n`pnpm test`",
    });

    await translatePage(
      {
        titleJa: "ガイド",
        summaryJa: "概要",
        contentJa: "## セットアップ\n\n![ロゴ](/images/logo.png)\n\n`pnpm test`",
      },
      { id: "test", generateText: vi.fn(), generateObject } as WikiModel,
    );

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Return Markdown, never TipTap/ProseMirror JSON."),
      }),
    );
  });
});
