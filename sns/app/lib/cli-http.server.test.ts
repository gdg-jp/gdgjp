import { describe, expect, it } from "vitest";
import { MAX_CLI_JSON_BODY_BYTES, parseCliJsonBody } from "./cli-http.server";

const url = "https://sns.gdgs.jp/api/cli/v1/posts";

/** A chunked JSON request with no `Content-Length` header. */
function streamedJsonRequest(totalBytes: number): Request {
  const chunk = new TextEncoder().encode("a".repeat(1024));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    // @ts-expect-error `duplex` is required by undici for a stream body.
    duplex: "half",
  });
}

describe("parseCliJsonBody", () => {
  it("rejects a chunked oversized body that declares no Content-Length", async () => {
    const request = streamedJsonRequest(MAX_CLI_JSON_BODY_BYTES + 8 * 1024);
    expect(request.headers.get("content-length")).toBeNull();

    const result = await parseCliJsonBody(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      await expect(result.response.json()).resolves.toEqual({ error: "payload_too_large" });
    }
  });

  it("rejects a plain oversized body (Content-Length path)", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(MAX_CLI_JSON_BODY_BYTES) }),
    });
    const result = await parseCliJsonBody(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects a non-JSON content type with 415", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    const result = await parseCliJsonBody(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  it("counts the cap in UTF-8 bytes, not UTF-16 code units", async () => {
    // Each `é` is 2 UTF-8 bytes but 1 JS string char; a payload that fits in
    // MAX_CLI_JSON_BODY_BYTES chars can still blow the byte cap.
    const filler = "é".repeat(MAX_CLI_JSON_BODY_BYTES - 20);
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: filler }),
    });
    const result = await parseCliJsonBody(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("parses a small well-formed JSON object", async () => {
    const request = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterId: 1, text: "hi" }),
    });
    const result = await parseCliJsonBody<{ chapterId: number }>(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.chapterId).toBe(1);
  });
});
