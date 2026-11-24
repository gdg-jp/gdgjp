import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

const app = "https://accounts.example";

describe("safeReturnTo", () => {
  it.each([
    ["/chapters/tokyo", "/chapters/tokyo"],
    ["/chapters/tokyo?tab=members&x=1#roles", "/chapters/tokyo?tab=members&x=1#roles"],
    ["/x?next=//evil.example", "/x?next=//evil.example"],
    ["https://accounts.example/chapters/tokyo?x=1#y", "/chapters/tokyo?x=1#y"],
    ["/%09/evil.example", "/%09/evil.example"],
    ["%2F%2Fevil.example", "/%2F%2Fevil.example"],
    ["chapters", "/chapters"],
  ])("keeps the same-origin target %j as the path %j", (value, path) => {
    expect(safeReturnTo(value, app)).toBe(path);
  });

  it.each([
    "/\t/evil.example",
    "/\r\n/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "\t//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\\/evil.example",
    "//evil.example",
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "https://evil.example/after",
    "https://accounts.example.evil.example/",
    "https://sibling.example/",
    "http://accounts.example/chapters",
    "https://accounts.example:8443/chapters",
    "javascript:alert(1)",
    "JavaScript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "http://[",
    "",
    null,
    undefined,
  ])("refuses %j", (value) => {
    expect(safeReturnTo(value, app)).toBeNull();
  });

  it("compares against the origin of an app URL that has a path", () => {
    expect(safeReturnTo("/after", "https://app.example/base/")).toBe("/after");
    expect(safeReturnTo("after", "https://app.example/base/")).toBe("/base/after");
    expect(safeReturnTo("https://app.example/after", "https://app.example/base")).toBe("/after");
    expect(safeReturnTo("https://evil.example/", "https://app.example/base")).toBeNull();
  });
});
