import { describe, expect, it } from "vitest";
import { loader } from "./$";

function runLoader(path: string, splat: string) {
  const request = new Request(`http://localhost${path}`);
  return loader({
    request,
    context: {} as Parameters<typeof loader>[0]["context"],
    params: { "*": splat },
    unstable_pattern: "*",
    unstable_url: new URL(request.url),
  });
}

describe("catch-all $ loader — bare path to /wiki redirect", () => {
  it("301-redirects a bare single-segment path to /wiki/<path>", () => {
    try {
      runLoader("/child", "child");
      expect.unreachable("expected redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      const res = response as Response;
      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("/wiki/child");
    }
  });

  it("301-redirects a bare multi-segment path to /wiki/<path>, preserving order", () => {
    try {
      runLoader("/foo/bar", "foo/bar");
      expect.unreachable("expected redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      const res = response as Response;
      expect(res.status).toBe(301);
      expect(res.headers.get("Location")).toBe("/wiki/foo/bar");
    }
  });

  it("preserves the query string on redirect", () => {
    try {
      runLoader("/child?lang=en", "child");
      expect.unreachable("expected redirect");
    } catch (response) {
      const res = response as Response;
      expect(res.headers.get("Location")).toBe("/wiki/child?lang=en");
    }
  });

  it("404s when there is no path to redirect (empty splat)", () => {
    try {
      runLoader("/", "");
      expect.unreachable("expected 404");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(404);
    }
  });
});
