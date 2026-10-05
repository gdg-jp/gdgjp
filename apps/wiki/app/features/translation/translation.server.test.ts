import { describe, expect, it, vi } from "vitest";
import {
  type TranslationSegmentStore,
  prepareMarkdownTranslation,
  translatePage,
  translationSourceHash,
} from "./translation.server";

function deterministicTranslation(text: string): string {
  return text
    .replaceAll("イベントレポート", "Event report")
    .replaceAll("短い概要", "A short summary")
    .replaceAll("セットアップ", "Setup")
    .replaceAll("公式サイト", "official website")
    .replaceAll("ロゴ", "Logo")
    .replaceAll("重要です", "is important")
    .replaceAll("表の値", "Table value")
    .replaceAll("本文です", "Body text");
}

function memoryStore(): TranslationSegmentStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getMany: async (keys) =>
      new Map(keys.flatMap((key) => (values.has(key) ? [[key, values.get(key) as string]] : []))),
    put: async (key, value) => {
      values.set(key, value);
    },
  };
}

describe("prepareMarkdownTranslation", () => {
  it("preserves Markdown, URLs, code, front matter, HTML, and ACL tags", () => {
    const source = [
      "---",
      "title: 日本語のまま",
      "---",
      "# セットアップ",
      "",
      "[公式サイト](https://example.com/a_(b)?q=1) と ![ロゴ](/img/logo.png) は**重要です**。",
      "",
      "| 列 | 値 |",
      "| --- | --- |",
      "| 名前 | 表の値 |",
      "",
      '<acl src="source-1">本文です</acl>',
      "",
      "```ts",
      'const message = "日本語のコード";',
      "```",
      "<div>",
      "本文です",
      "</div>",
      "本文です<!-- 固定コメント -->本文です",
    ].join("\n");
    const prepared = prepareMarkdownTranslation(source);
    const result = prepared.render(
      prepared.segments.map((segment) => deterministicTranslation(segment.text)),
    );

    expect(result).toContain("title: 日本語のまま");
    expect(result).toContain("# Setup");
    expect(result).toContain("[official website](https://example.com/a_(b)?q=1)");
    expect(result).toContain("![Logo](/img/logo.png)");
    expect(result).toContain("**is important**");
    expect(result).toContain("| 名前 | Table value |");
    expect(result).toContain('<acl src="source-1">Body text</acl>');
    expect(result).toContain('const message = "日本語のコード";');
    expect(result).toContain("<div>\nBody text\n</div>");
    expect(result).toContain("Body text<!-- 固定コメント -->Body text");
  });

  it("never exposes Markdown syntax to the translator", async () => {
    const translator = vi.fn(async (text: string) => deterministicTranslation(text));
    await translatePage(
      {
        titleJa: "イベントレポート",
        summaryJa: "短い概要",
        contentJa:
          '# セットアップ\n\n[公式サイト](https://example.com) と `コード` と <acl src="s">本文です</acl>',
      },
      { modelId: "test-model", translator },
    );

    for (const [text] of translator.mock.calls) {
      expect(text).not.toMatch(/https?:\/\/|<\/?acl|`|\]\(|^#\s/u);
    }
  });
});

describe("translatePage", () => {
  it("reuses unchanged segments across page translations", async () => {
    const store = memoryStore();
    const translator = vi.fn(async (text: string) => deterministicTranslation(text));
    const input = {
      titleJa: "イベントレポート",
      summaryJa: "短い概要",
      contentJa: "# セットアップ\n\n本文です",
    };

    const first = await translatePage(input, { modelId: "test-model", translator, store });
    const callsAfterFirst = translator.mock.calls.length;
    const second = await translatePage(input, { modelId: "test-model", translator, store });

    expect(first).toMatchObject({
      titleEn: "Event report",
      summaryEn: "A short summary",
      contentEn: "# Setup\n\nBody text",
      stats: { cacheHits: 0, cacheMisses: 4 },
    });
    expect(second.stats).toEqual({ cacheHits: 4, cacheMisses: 0 });
    expect(translator).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("changes the source hash when any Japanese field changes", async () => {
    const base = { titleJa: "題", summaryJa: "概要", contentJa: "本文" };
    await expect(translationSourceHash(base)).resolves.not.toBe(
      await translationSourceHash({ ...base, contentJa: "更新本文" }),
    );
  });
});
