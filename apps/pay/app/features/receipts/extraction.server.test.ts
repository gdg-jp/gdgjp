import { afterEach, describe, expect, it, vi } from "vitest";
import { receiptExtractor } from "./extraction.server";

const file = { bytes: new Uint8Array([1, 2, 3]).buffer, mimeType: "image/png", filename: "r.png" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("receiptExtractor", () => {
  it.each(["", "   ", "\n\t", undefined])("is not configured when the key is %j", (key) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      receiptExtractor({ GEMINI_API_KEY: key as string, GEMINI_MODEL_ID: "gemini-test" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the receipt to Gemini with the trimmed key and parses the reply", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"spentOn":"2026-11-01","amountYen":"¥3,300","category":"会場費","description":"会場"}',
                },
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const extract = receiptExtractor({ GEMINI_API_KEY: " key-1 ", GEMINI_MODEL_ID: "gemini-test" });
    expect(extract).not.toBeNull();
    await expect(extract?.(file)).resolves.toEqual({
      spentOn: "2026-11-01",
      amountYen: 3300,
      category: "会場費",
      description: "会場",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent?key=key-1",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
