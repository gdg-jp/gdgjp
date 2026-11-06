import { describe, expect, it } from "vitest";
import { buildPageMirror, spanAudience } from "./mirror";

const sources = new Map([
  ["org", { id: "org", visibility: "organizer", chapterId: null, addedBy: "o" }],
  ["mem", { id: "mem", visibility: "member", chapterId: null, addedBy: "o" }],
  ["tokyo", { id: "tokyo", visibility: "chapter-member", chapterId: "tokyo", addedBy: "o" }],
  ["osaka", { id: "osaka", visibility: "chapter-member", chapterId: "osaka", addedBy: "o" }],
  ["mine", { id: "mine", visibility: "private", chapterId: null, addedBy: "o" }],
]);

const page = {
  id: "p1",
  titleJa: "会場",
  titleEn: "",
  contentJa:
    '会場は梅田。\n\n<acl src="org">契約金額は 12 万円。</acl>\n\n<acl src="tokyo">東京の担当は山田。</acl>',
  contentEn: "",
  pageType: "event",
  origin: "agent",
  updatedAt: new Date("2026-11-06T00:00:00Z"),
};

describe("buildPageMirror", () => {
  it("never puts span text into the page item", () => {
    const { items } = buildPageMirror(page, sources);
    const body = items.find((item) => item.key === "pages/p1.ja.md")?.body ?? "";
    expect(body).toContain("会場は梅田");
    expect(body).not.toContain("12 万円");
    expect(body).not.toContain("山田");
    expect(body).not.toContain("<acl");
  });

  it("puts each span in an item of exactly its audience", () => {
    const { items } = buildPageMirror(page, sources);
    const org = items.find((item) => item.metadata.audience === "organizer");
    const tokyo = items.find((item) => item.metadata.audience === "chapter-member:tokyo");
    expect(org?.body).toContain("12 万円");
    expect(org?.body).not.toContain("山田");
    expect(tokyo?.body).toContain("山田");
    expect(items.map((item) => item.metadata.layer).sort()).toEqual(["acl", "acl", "page"]);
  });
});

describe("spanAudience", () => {
  it("takes the narrowest audience when it contains the others", () => {
    expect(spanAudience(["org", "mem"], sources)).toBe("organizer");
    expect(spanAudience(["tokyo", "mem"], sources)).toBe("chapter-member:tokyo");
  });

  it("refuses incomparable, private-mixed and unknown citations", () => {
    expect(spanAudience(["tokyo", "osaka"], sources)).toBeNull();
    expect(spanAudience(["mine", "mem"], sources)).toBeNull();
    expect(spanAudience(["missing"], sources)).toBeNull();
  });

  it("keeps a single private source as its owner's audience", () => {
    expect(spanAudience(["mine"], sources)).toBe("private:o");
  });
});
