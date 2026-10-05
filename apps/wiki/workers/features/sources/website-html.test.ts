import { describe, expect, it } from "vitest";
import {
  extractCssImportUrls,
  extractHtmlTitle,
  extractStylesheetUrls,
  resolveHttpUrl,
  rewriteCssImports,
  rewriteStylesheetHrefs,
} from "./website-html";

describe("website-html helpers", () => {
  it("resolves relative stylesheet hrefs against the page URL", () => {
    expect(resolveHttpUrl("https://example.com/docs/page", "styles/main.css")).toBe(
      "https://example.com/docs/styles/main.css",
    );
    expect(resolveHttpUrl("https://example.com/docs/page", "/abs.css")).toBe(
      "https://example.com/abs.css",
    );
    expect(resolveHttpUrl("https://example.com/", "javascript:alert(1)")).toBeNull();
    expect(resolveHttpUrl("https://example.com/", "data:text/css,body{}")).toBeNull();
  });

  it("extracts the HTML title", () => {
    expect(extractHtmlTitle("<html><head><title>  Hello  World </title></head></html>")).toBe(
      "Hello World",
    );
    expect(extractHtmlTitle("<html><body>no title</body></html>")).toBeNull();
  });

  it("extracts stylesheet hrefs and rewrites them to asset paths", () => {
    const pageUrl = "https://example.com/app/";
    const html = `
      <link rel="icon" href="/favicon.ico">
      <link rel="stylesheet" href="a.css">
      <link href='https://cdn.example.com/b.css' rel="stylesheet">
      <link rel="stylesheet preload" href="../c.css">
    `;
    expect(extractStylesheetUrls(html, pageUrl)).toEqual([
      "https://example.com/app/a.css",
      "https://cdn.example.com/b.css",
      "https://example.com/c.css",
    ]);

    const rewritten = rewriteStylesheetHrefs(
      html,
      pageUrl,
      new Map([
        ["https://example.com/app/a.css", "raw/src/assets/a.css"],
        ["https://cdn.example.com/b.css", "raw/src/assets/b.css"],
        ["https://example.com/c.css", "raw/src/assets/c.css"],
      ]),
    );
    expect(rewritten).toContain('href="raw/src/assets/a.css"');
    expect(rewritten).toContain('href="raw/src/assets/b.css"');
    expect(rewritten).toContain('href="raw/src/assets/c.css"');
    expect(rewritten).toContain('href="/favicon.ico"');
  });

  it("extracts one level of CSS @import and rewrites matching imports", () => {
    const css = `
      @import url("shared.css");
      @import 'theme.css' screen;
      @import url(https://cdn.example.com/base.css);
      body { color: red; }
    `;
    const base = "https://example.com/css/main.css";
    expect(extractCssImportUrls(css, base)).toEqual([
      "https://example.com/css/shared.css",
      "https://example.com/css/theme.css",
      "https://cdn.example.com/base.css",
    ]);

    const rewritten = rewriteCssImports(
      css,
      base,
      new Map([
        ["https://example.com/css/shared.css", "raw/src/assets/shared.css"],
        ["https://cdn.example.com/base.css", "raw/src/assets/base.css"],
      ]),
    );
    expect(rewritten).toContain('@import url("raw/src/assets/shared.css")');
    expect(rewritten).toContain("@import 'theme.css' screen");
    expect(rewritten).toContain("@import url(raw/src/assets/base.css)");
  });
});
