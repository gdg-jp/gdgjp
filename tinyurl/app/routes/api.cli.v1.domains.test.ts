import type { AuthUser } from "@gdgjp/gdg-lib";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "./+types/api.cli.v1.domains";
import { action, loader } from "./api.cli.v1.domains";

vi.mock("~/lib/cli-auth.server", () => ({
  requireCliActor: vi.fn(async () => ({
    ok: true,
    actor: {
      user: { id: "u1", email: "a@b.c", name: "A", image: null, isAdmin: false } as AuthUser,
      chapters: [],
    },
  })),
}));

vi.mock("~/features/domains", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/features/domains")>();
  return { ...actual, listDomainsForChapters: vi.fn(async () => []) };
});

const env = {} as Env;
const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

function actionArgs(request: Request): Route.ActionArgs {
  return {
    request,
    params: {},
    context: { cloudflare: { env, ctx } },
  } as unknown as Route.ActionArgs;
}

function loaderArgs(request: Request): Route.LoaderArgs {
  return {
    request,
    params: {},
    context: { cloudflare: { env, ctx } },
  } as unknown as Route.LoaderArgs;
}

const url = "https://example.com/api/cli/v1/domains";

describe("api.cli.v1.domains action — the documented CLI HTTP boundary", () => {
  it("returns a JSON 405 (not plain text) for an unsupported method", async () => {
    const res = await action(actionArgs(new Request(url, { method: "PUT" })));
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "method_not_allowed" });
  });

  it("rejects a POST without an application/json Content-Type", async () => {
    const res = await action(
      actionArgs(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      ),
    );
    expect(res.status).toBe(415);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an oversized POST body", async () => {
    const oversized = JSON.stringify({ hostname: "x".repeat(20_000), chapterId: 1 });
    const res = await action(
      actionArgs(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: oversized,
        }),
      ),
    );
    expect(res.status).toBe(413);
  });

  it("rejects malformed JSON with the shared { error } envelope", async () => {
    const res = await action(
      actionArgs(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        }),
      ),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("rejects a well-formed JSON body missing required fields", async () => {
    const res = await action(
      actionArgs(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hostname: "gdg-tokyo.jp" }),
        }),
      ),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_request" });
  });
});

describe("api.cli.v1.domains loader — no-store on authenticated responses", () => {
  it("sets Cache-Control: no-store on a successful list response", async () => {
    const res = await loader(loaderArgs(new Request(url)));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
