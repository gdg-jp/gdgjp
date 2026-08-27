import { describe, expect, it } from "vitest";
import { loader as mediaIdLoader } from "./api.cli.v1.media.$id";
import { loader as postMediaLoader } from "./api.cli.v1.posts.$id.media";
import { loader as postPublishLoader } from "./api.cli.v1.posts.$id.publish";
import { action as xAccountsAction } from "./api.cli.v1.x-accounts";
import { loader as xAccountIdLoader } from "./api.cli.v1.x-accounts.$id";

/**
 * Action-only CLI routes have no loader of their own, so a GET/HEAD would fall
 * through to framework handling instead of the documented JSON 405. Each such
 * route now exports a guard; likewise the GET-only x-accounts collection guards
 * write verbs. These are pure and never touch `env`.
 */
const noArgs = {} as never;

describe("CLI method guards on action-only / loader-only routes", () => {
  it.each([
    ["GET /api/cli/v1/posts/:id/media", () => postMediaLoader(noArgs)],
    ["GET /api/cli/v1/posts/:id/publish", () => postPublishLoader(noArgs)],
    ["GET /api/cli/v1/media/:id", () => mediaIdLoader(noArgs)],
    ["GET /api/cli/v1/x-accounts/:id", () => xAccountIdLoader(noArgs)],
    ["POST /api/cli/v1/x-accounts", () => xAccountsAction(noArgs)],
  ])("%s returns a JSON 405 with the shared { error } shape", async (_label, run) => {
    const res = run();
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ error: "method_not_allowed" });
  });
});
