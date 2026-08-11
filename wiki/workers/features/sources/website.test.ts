import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWebsiteSource } from "./website";
import { MAX_HTML_BYTES, MAX_STYLESHEETS } from "./website-html";

function htmlResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function cssResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/css" },
  });
}

describe("fetchWebsiteSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads HTML and linked CSS, rewriting hrefs and one-level @import", async () => {
    const puts: Array<{ key: string; body: string }> = [];
    const env = {
      BUCKET: {
        put: vi.fn(async (key: string, body: ArrayBuffer | Uint8Array | string) => {
          const bytes =
            typeof body === "string"
              ? new TextEncoder().encode(body)
              : body instanceof Uint8Array
                ? body
                : new Uint8Array(body);
          puts.push({ key, body: new TextDecoder().decode(bytes) });
        }),
      },
    } as unknown as Env;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://example.com/page") {
          return htmlResponse(
            `<html><head><title>Demo</title><link rel="stylesheet" href="/main.css"></head><body>hi</body></html>`,
          );
        }
        if (url === "https://example.com/main.css") {
          return cssResponse('@import url("shared.css");\nbody{color:red}');
        }
        if (url === "https://example.com/shared.css") {
          return cssResponse("@import url('ignored-second-level.css');\np{margin:0}");
        }
        if (url === "https://example.com/ignored-second-level.css") {
          throw new Error("second-level @import must not be fetched");
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const result = await fetchWebsiteSource(env, "src-1", "https://example.com/page");
    expect(result.title).toBe("Demo");
    expect(result.assets).toHaveLength(2);
    expect(result.html).toMatch(/href="raw\/src-1\/assets\/[^"]+\.css"/);
    expect(result.html).not.toContain('href="/main.css"');
    expect(puts).toHaveLength(2);
    const main = puts.find((entry) => entry.body.includes("body{color:red}"));
    expect(main?.body).toContain("raw/src-1/assets/");
    expect(main?.body).not.toContain("shared.css");
    const shared = puts.find((entry) => entry.body.includes("p{margin:0}"));
    expect(shared?.body).toContain("@import url('ignored-second-level.css')");
  });

  it("rejects non-2xx HTML responses", async () => {
    const env = { BUCKET: { put: vi.fn() } } as unknown as Env;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(fetchWebsiteSource(env, "src-1", "https://example.com/missing")).rejects.toThrow(
      /404/,
    );
  });

  it("rejects HTML that exceeds the size limit", async () => {
    const env = { BUCKET: { put: vi.fn() } } as unknown as Env;
    const huge = "x".repeat(MAX_HTML_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(huge)),
    );
    await expect(fetchWebsiteSource(env, "src-1", "https://example.com/")).rejects.toThrow(/5 MB/);
  });

  it("rejects more than MAX_STYLESHEETS linked stylesheets", async () => {
    const env = { BUCKET: { put: vi.fn() } } as unknown as Env;
    const links = Array.from(
      { length: MAX_STYLESHEETS + 1 },
      (_, index) => `<link rel="stylesheet" href="/s${index}.css">`,
    ).join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(`<html><head>${links}</head></html>`)),
    );
    await expect(fetchWebsiteSource(env, "src-1", "https://example.com/")).rejects.toThrow(
      /stylesheets/,
    );
  });
});
