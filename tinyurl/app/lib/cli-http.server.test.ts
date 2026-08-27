import { describe, expect, it } from "vitest";
import {
  MAX_CLI_JSON_BODY_BYTES,
  cliError,
  cliJson,
  cliMethodNotAllowed,
  parseCliJsonBody,
} from "./cli-http.server";

describe("cliJson / cliError / cliMethodNotAllowed", () => {
  it("cliJson sets Cache-Control: no-store and the given status", async () => {
    const res = cliJson({ ok: true }, { status: 202 });
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("cliError returns the shared { error } envelope with no-store", async () => {
    const res = cliError("not_found", 404);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });

  it("cliMethodNotAllowed returns a JSON 405, not plain text", async () => {
    const res = cliMethodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "method_not_allowed" });
  });
});

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/cli/v1/domains", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("parseCliJsonBody", () => {
  it("parses a well-formed application/json body", async () => {
    const result = await parseCliJsonBody<{ hostname: string }>(
      jsonRequest('{"hostname":"gdg-tokyo.jp"}'),
    );
    expect(result).toEqual({ ok: true, value: { hostname: "gdg-tokyo.jp" } });
  });

  it("rejects a missing or non-JSON Content-Type with 415", async () => {
    const noContentType = new Request("https://example.com/api/cli/v1/domains", {
      method: "POST",
      body: "{}",
    });
    const result = await parseCliJsonBody(noContentType);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(415);
    await expect(result.response.json()).resolves.toEqual({ error: "unsupported_media_type" });

    const wrongContentType = jsonRequest("{}", { "content-type": "text/plain" });
    const result2 = await parseCliJsonBody(wrongContentType);
    expect(result2.ok).toBe(false);
  });

  it("rejects a body whose declared Content-Length exceeds the max with 413", async () => {
    const request = jsonRequest("{}", {
      "content-length": String(MAX_CLI_JSON_BODY_BYTES + 1),
    });
    const result = await parseCliJsonBody(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    await expect(result.response.json()).resolves.toEqual({ error: "payload_too_large" });
  });

  it("rejects a body that is actually oversized even without a (correct) Content-Length", async () => {
    const oversized = "x".repeat(MAX_CLI_JSON_BODY_BYTES + 1);
    const request = jsonRequest(oversized);
    const result = await parseCliJsonBody(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
  });

  it("rejects malformed JSON with 400", async () => {
    const result = await parseCliJsonBody(jsonRequest("{not json"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it.each(['"a string"', "[1,2,3]", "null", "42"])(
    "rejects well-formed but non-object JSON (%s) with 400, not a thrown TypeError",
    async (body) => {
      const result = await parseCliJsonBody(jsonRequest(body));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toEqual({ error: "invalid_json" });
    },
  );

  it("every rejection response carries Cache-Control: no-store", async () => {
    const result = await parseCliJsonBody(jsonRequest("{not json"));
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.headers.get("cache-control")).toBe("no-store");
  });
});
