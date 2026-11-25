import { describe, expect, it } from "vitest";
import { htmlText, htmlTokens } from "./html";

describe("htmlTokens", () => {
  it("splits text and tags in one pass", () => {
    expect(htmlTokens('<p class="a">Hi <b>you</b></p>')).toEqual([
      { kind: "tag", name: "p", closing: false, source: '<p class="a">' },
      { kind: "text", text: "Hi " },
      { kind: "tag", name: "b", closing: false, source: "<b>" },
      { kind: "text", text: "you" },
      { kind: "tag", name: "b", closing: true, source: "</b>" },
      { kind: "tag", name: "p", closing: true, source: "</p>" },
    ]);
  });

  it("drops comments and skipped elements with their content", () => {
    const html = "a<!-- x --><SCRIPT>alert(1)</script>b<style>p{}</STYLE >c";
    expect(htmlText(html, { skip: ["script", "style"] })).toBe("abc");
  });

  it("cannot reassemble a tag out of the pieces around a removed element", () => {
    const html = "<scr<script>x</script>ipt>alert(1)</script><!<!-- -->-- y -->";
    const text = htmlText(html, { skip: ["script"], tag: () => "" });
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toContain("<!--");
  });

  it("never emits markup from an unterminated tag or comment", () => {
    expect(htmlText("ok <script src=x")).toBe("ok ");
    expect(htmlText("ok <!-- open")).toBe("ok ");
    expect(htmlText("ok <script>never closed", { skip: ["script"] })).toBe("ok ");
  });

  it("keeps text HTML-encoded, so a bare angle bracket stays an entity", () => {
    expect(htmlText("1 < 2 > 0")).toBe("1 &lt; 2 > 0");
    expect(htmlText("<<script>x</script>script>", { skip: ["script"] })).toBe("&lt;script>");
    expect(
      htmlTokens("a<b").every((token) => token.kind !== "text" || !token.text.includes("<")),
    ).toBe(true);
  });

  it("drops declarations and bogus comments up to the next bracket", () => {
    expect(htmlText("<!DOCTYPE html><?xml x?>a</ 1>b")).toBe("ab");
  });

  it("does not wait for the closing tag of a self-closed skipped element", () => {
    expect(htmlText("a<svg/>b<svg><g/></svg>c", { skip: ["svg"] })).toBe("abc");
  });

  it("lets the caller choose what a tag becomes", () => {
    const text = htmlText("a<br>b</p>c<i>d</i>", {
      tag: ({ name }) => (name === "br" || name === "p" ? "\n" : ""),
    });
    expect(text).toBe("a\nb\ncd");
  });
});
