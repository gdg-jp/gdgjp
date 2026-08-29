import { describe, expect, it } from "vitest";
import {
  type WikiHumanPageInput,
  parseWikiCloneLanguage,
  renderWikiHumanDocument,
  sha256Hex,
} from "./cli-wiki-human.server";

const page: WikiHumanPageInput = {
  id: "page-1",
  slug: "event-report",
  sortOrder: 1,
  pageType: "event",
  pageMetadata: null,
  visibility: "restricted",
  generalRole: "viewer",
  chapterId: null,
  titleJa: "イベント報告",
  titleEn: "Event report",
  summaryJa: "日本語の要約",
  summaryEn: "English summary",
  contentJa: "日本語の本文\n",
  contentEn: "English body\n",
  translationStatusJa: "human",
  translationStatusEn: "human",
  parentSlug: "events",
  tags: ["event"],
  access: [],
  sources: [],
  attachments: [],
};

describe("parseWikiCloneLanguage", () => {
  it.each([
    [null, "ja"],
    ["ja", "ja"],
    ["en", "en"],
    ["fr", null],
  ])("parses %s as %s", (value, expected) => {
    expect(parseWikiCloneLanguage(value)).toBe(expected);
  });
});

describe("renderWikiHumanDocument", () => {
  it("returns the localized title and bytes used for hashing", async () => {
    const ja = renderWikiHumanDocument(page, "ja");
    const en = renderWikiHumanDocument(page, "en");

    expect(ja.title).toBe("イベント報告");
    expect(ja.markdown).toContain("language: ja");
    expect(ja.markdown).toContain("日本語の本文");
    expect(en.title).toBe("Event report");
    expect(en.markdown).toContain("language: en");
    expect(en.markdown).toContain("English body");
    expect(await sha256Hex(ja.markdown)).not.toBe(await sha256Hex(en.markdown));
  });

  it("changes only the English rendering hash for an English-only edit", async () => {
    const changed = { ...page, contentEn: "Updated English body\n" };

    expect(await sha256Hex(renderWikiHumanDocument(changed, "ja").markdown)).toBe(
      await sha256Hex(renderWikiHumanDocument(page, "ja").markdown),
    );
    expect(await sha256Hex(renderWikiHumanDocument(changed, "en").markdown)).not.toBe(
      await sha256Hex(renderWikiHumanDocument(page, "en").markdown),
    );
  });
});
