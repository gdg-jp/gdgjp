import {
  buildDesignHtml,
  sanitizeDesignHtml,
} from "@skills/pr-playbook/scripts/render/design-html.mjs";
import { describe, expect, it } from "vitest";
import { pickReferences } from "~/features/design/reference.repository.server";

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

describe("pickReferences", () => {
  const ref = (id: string, kind: string, madeOn: string) => ({
    id,
    chapterId: 1,
    kind: kind as "thumbnail",
    event: "",
    madeOn,
    note: "",
    contentType: "image/jpeg",
    bytes: 1,
    r2Key: id,
    createdBy: "u",
    createdAt: 0,
  });
  const all = [
    ref("t-old", "thumbnail", "2026-07-01"),
    ref("t-new", "thumbnail", "2026-10-01"),
    ref("s-new", "session", "2026-10-01"),
    ref("s-old", "session", "2026-08-01"),
    ref("a", "ad", "2026-10-01"),
  ];
  it("prefers the matching kind, newest first, then the face", () => {
    expect(pickReferences(all, "session", 3).map((r) => r.id)).toEqual(["s-new", "s-old", "t-new"]);
  });
  it("for the kit shows the faces first and one of each other kind", () => {
    expect(pickReferences(all, "kit", 4).map((r) => r.id)).toEqual([
      "t-new",
      "t-old",
      "s-new",
      "a",
    ]);
  });
});
