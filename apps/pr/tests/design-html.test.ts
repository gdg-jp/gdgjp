// Covers the Playbook's design-html.mjs (gdg-jp/skills submodule), which render.server.ts bundles;
// its subject is outside app/, so it lives here rather than beside a module.
import { describe, expect, it } from "vitest";
import {
  buildDesignHtml,
  sanitizeDesignHtml,
} from "../../../skills/pr-playbook/scripts/render/design-html.mjs";

const render = { thumbnailScale: 0.25, minFontPxAtThumbnail: 9, minContrast: 4.5 };

describe("design HTML", () => {
  it("drops scripts, event handlers and outside URLs, keeps bundle assets and allowed hosts", () => {
    const { body, css, problems } = sanitizeDesignHtml(
      `<style>.a{background:url(https://evil.example/x.png)} @import "x.css";</style>
       <div class="canvas" onclick="alert(1)"><script>alert(1)</script>
       <img data-logo src="assets/gdg.svg"><img src="https://evil.example/a.png">
       <img src="https://img.gdgs.jp/abc"><a href="javascript:alert(1)">x</a></div>`,
      { "assets/gdg.svg": "data:image/svg+xml;base64,PHN2Zy8+" },
    );
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("evil.example");
    expect(body).toContain('src="data:image/svg+xml;base64,PHN2Zy8+"');
    expect(body).toContain('src="https://img.gdgs.jp/abc"');
    expect(css).not.toContain("@import");
    expect(css).toContain("none");
    expect(problems.length).toBeGreaterThan(0);
  });

  it("wraps the page with fonts, a CSP and the checks script, and reports a missing canvas or logo", () => {
    const { html, problems } = buildDesignHtml({
      html: '<p data-slot="headline" data-required="true">Hi</p>',
      width: 1600,
      height: 900,
      fontsBase: "https://pr.gdgs.jp/fonts",
      checksScript: "/*checks*/",
      render,
    });
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("@font-face");
    expect(html).toContain('class="canvas"');
    expect(html).toContain('"width":1600');
    expect(problems.join(" ")).toMatch(/canvas/);
    expect(problems.join(" ")).toMatch(/ロゴ/);
  });
});
