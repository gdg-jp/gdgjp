import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import HomePage, { meta as homeMeta } from "~/routes/site/home";
import PrivacyPage, { meta as privacyMeta } from "~/routes/site/privacy";
import TermsPage, { meta as termsMeta } from "~/routes/site/terms";

describe("public site route screens", () => {
  it.each([
    [HomePage, homeMeta, "GDG Japan", "コミュニティの活動を、もっと身近に。"],
    [PrivacyPage, privacyMeta, "プライバシーポリシー | GDG Japan", "1. 適用範囲"],
    [TermsPage, termsMeta, "利用規約 | GDG Japan", "1. 適用"],
  ] as const)("renders %s with public navigation and metadata", (Page, meta, title, content) => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );

    expect(html).toContain(content);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(meta()).toContainEqual({ title });
  });

  it("links every GDG application from the home screen", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    for (const app of GDG_APP_LINKS) {
      expect(html).toContain(`href="${app.url}"`);
      expect(html).toContain(app.label);
    }
  });
});
