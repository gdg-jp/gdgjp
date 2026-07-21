import { describe, expect, it, vi } from "vitest";
import type { WikiModel } from "~/features/ai/model/index.server";
import { translatePage } from "./translation.server";

describe("translatePage", () => {
  it("uses a structured provider request and preserves the public result shape", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      titleEn: "Event report",
      summaryEn: "A short summary",
      contentEn: '{"type":"doc","content":[]}',
    });

    const result = await translatePage(
      {
        titleJa: "イベントレポート",
        summaryJa: "概要",
        contentJa: '{"type":"doc","content":[]}',
      },
      { id: "test", generateText: vi.fn(), generateObject } as WikiModel,
    );

    expect(result).toEqual({
      titleEn: "Event report",
      summaryEn: "A short summary",
      contentEn: '{"type":"doc","content":[]}',
    });
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaName: "wiki_translation",
        temperature: 0,
        prompt: expect.stringContaining("イベントレポート"),
      }),
    );
  });
});
