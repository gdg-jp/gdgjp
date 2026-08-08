import { describe, expect, it } from "vitest";
import {
  buildNewPageLocaleValues,
  buildPartialLocaleUpdate,
  humanOriginSyncError,
  humanParentSyncError,
  jaContentChanged,
  sourceHasReference,
} from "./api.cli.wiki.sync.helpers";

const baseRow = {
  titleJa: "旧タイトル",
  summaryJa: "旧要約",
  contentJa: "旧本文",
  translationStatusJa: "human",
  titleEn: "Old title",
  summaryEn: "Old summary",
  contentEn: "Old body",
  translationStatusEn: "ai",
};

const baseMeta = {
  pageType: "event",
  pageMetadata: null,
  visibility: "restricted",
  generalRole: "viewer",
  chapterId: null,
};

describe("jaContentChanged", () => {
  it("returns false when ja payload is omitted", () => {
    expect(jaContentChanged(baseRow, undefined, "canonical")).toBe(false);
  });

  it("returns true when title changes", () => {
    expect(
      jaContentChanged(
        baseRow,
        { title: "新タイトル", summary: "旧要約", translationStatus: "human", content: "旧本文" },
        "旧本文",
      ),
    ).toBe(true);
  });

  it("returns true when canonical content changes", () => {
    expect(
      jaContentChanged(
        baseRow,
        { title: "旧タイトル", summary: "旧要約", translationStatus: "human", content: "新本文" },
        "新本文",
      ),
    ).toBe(true);
  });

  it("returns false when ja fields are unchanged", () => {
    expect(
      jaContentChanged(
        baseRow,
        { title: "旧タイトル", summary: "旧要約", translationStatus: "human", content: "旧本文" },
        "旧本文",
      ),
    ).toBe(false);
  });
});

describe("buildPartialLocaleUpdate", () => {
  const pageBase = {
    slug: "events-demo",
    parentId: "parent-1",
    sortOrder: 2,
    meta: baseMeta,
  };

  it("updates only ja locale columns when en is omitted", () => {
    const update = buildPartialLocaleUpdate(
      {
        ...pageBase,
        ja: { title: "新", summary: "要約", translationStatus: "human", content: "本文" },
      },
      "本文",
      undefined,
      "user-1",
      "page-1",
      3,
    );
    expect(update.sql).toContain("title_ja=?");
    expect(update.sql).toContain("content_ja=?");
    expect(update.sql).not.toContain("title_en=?");
    expect(update.sql).toContain("slug=?");
    expect(update.binds).toContain("events-demo");
    expect(update.binds.at(-1)).toBe(3);
  });

  it("updates only en locale columns when ja is omitted", () => {
    const update = buildPartialLocaleUpdate(
      {
        ...pageBase,
        en: { title: "New", summary: "Summary", translationStatus: "human", content: "Body" },
      },
      undefined,
      "Body",
      "user-1",
      "page-1",
      4,
    );
    expect(update.sql).toContain("title_en=?");
    expect(update.sql).not.toContain("title_ja=?");
  });

  it("updates both locales when both are present", () => {
    const update = buildPartialLocaleUpdate(
      {
        ...pageBase,
        ja: { title: "新", summary: "要約", translationStatus: "human", content: "本文" },
        en: { title: "New", summary: "Summary", translationStatus: "human", content: "Body" },
      },
      "本文",
      "Body",
      "user-1",
      "page-1",
      5,
    );
    expect(update.sql).toContain("title_ja=?");
    expect(update.sql).toContain("title_en=?");
  });

  it("updates shared columns when neither locale is present", () => {
    const update = buildPartialLocaleUpdate(pageBase, undefined, undefined, "user-1", "page-1", 6);
    expect(update.sql).not.toContain("title_ja=?");
    expect(update.sql).not.toContain("title_en=?");
    expect(update.sql).toContain("slug=?");
    expect(update.sql).toContain("page_type=?");
  });
});

describe("buildNewPageLocaleValues", () => {
  it("defaults EN to empty with missing translation status for JA-only pages", () => {
    expect(
      buildNewPageLocaleValues({
        slug: "demo",
        parentId: null,
        sortOrder: 0,
        ja: { title: "タイトル", summary: "要約", translationStatus: "human", content: "本文" },
        meta: baseMeta,
      }),
    ).toEqual({
      titleJa: "タイトル",
      titleEn: "",
      summaryJa: "要約",
      summaryEn: "",
      translationStatusJa: "human",
      translationStatusEn: "missing",
    });
  });
});

describe("origin validation helpers", () => {
  it("flags human pages for sync rejection", () => {
    expect(humanOriginSyncError("human")).toBe("human_origin");
    expect(humanOriginSyncError("agent")).toBeNull();
  });

  it("flags human parents for sync rejection", () => {
    expect(humanParentSyncError("human")).toBe("human_parent");
    expect(humanParentSyncError("agent")).toBeNull();
  });
});

describe("sourceHasReference", () => {
  it("accepts title with url", () => {
    expect(sourceHasReference({ title: "Doc", url: "https://example.com" })).toBe(true);
  });

  it("accepts title with sourceId", () => {
    expect(sourceHasReference({ title: "Doc", sourceId: "src-1" })).toBe(true);
  });

  it("rejects missing url and sourceId", () => {
    expect(sourceHasReference({ title: "Doc" })).toBe(false);
  });
});
