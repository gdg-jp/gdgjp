import { gdgAppLinks } from "@gdgjp/gdg-lib/ui/app-links";
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
        <Page {...pageProps("https://accounts.gdgs.jp")} />
      </MemoryRouter>,
    );

    expect(html).toContain(content);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(meta()).toContainEqual({ title });
  });

  it.each(["https://accounts.gdgs.jp", "https://accounts.stg1.gdgs.jp"])(
    "links every GDG application of the %s deployment from the home screen",
    (accountsUrl) => {
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <HomePage {...pageProps(accountsUrl)} />
        </MemoryRouter>,
      );

      for (const app of gdgAppLinks(accountsUrl)) {
        expect(html).toContain(`href="${app.url}"`);
        expect(html).toContain(app.label);
      }
      if (accountsUrl.includes("stg1")) expect(html).not.toContain('href="https://wiki.gdgs.jp"');
    },
  );
});

function pageProps(accountsUrl: string) {
  return { loaderData: { accountsUrl } } as unknown as Parameters<typeof HomePage>[0];
}
