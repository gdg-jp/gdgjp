import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliIdentity } from "~/lib/cli-identity.server";

const getCliIdentityMock = vi.fn<(...args: unknown[]) => unknown>();
const createStoreMock = vi.fn<(...args: unknown[]) => unknown>();
const getDbMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ tag: "db" }));
const createOrReplaceMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("~/lib/cli-identity.server", () => ({
  getCliIdentity: (...args: unknown[]) => getCliIdentityMock(...args),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: (...args: unknown[]) => createStoreMock(...args),
}));

vi.mock("~/lib/agent-notes.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/agent-notes.server")>(
    "~/lib/agent-notes.server",
  );
  return {
    ...actual,
    createOrReplaceAnswerNote: (...args: unknown[]) => createOrReplaceMock(...args),
  };
});

import { action } from "./api.agent.notes";

function identity(): CliIdentity {
  return {
    user: {
      id: "user-a",
      email: "a@example.com",
      name: "A",
      image: null,
      isAdmin: false,
    },
    chapters: [{ chapterId: 1, chapterSlug: "osaka", role: "member" }],
  };
}

function actionArgs(body: unknown) {
  const request = new Request("http://localhost/api/agent/notes", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    request,
    context: {
      cloudflare: { env: { tag: "env", APP_URL: "https://wiki.gdgs.jp" }, ctx: { tag: "ctx" } },
    } as never,
    params: {},
    unstable_pattern: "/api/agent/notes",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getCliIdentityMock.mockReset().mockResolvedValue(identity());
  createStoreMock.mockReset().mockReturnValue({ tag: "store" });
  getDbMock.mockClear();
  createOrReplaceMock.mockReset();
});

describe("POST /api/agent/notes", () => {
  it("returns 401 invalid_token without creating a note", async () => {
    getCliIdentityMock.mockResolvedValue(null);
    const response = await action(
      actionArgs({
        slug: "a",
        title: "A",
        summary: "s",
        content: "c".repeat(200),
        citedPaths: ["/wiki/a", "/wiki/b"],
      }),
    );
    expect(response.status).toBe(401);
    expect(createOrReplaceMock).not.toHaveBeenCalled();
  });

  it("returns the createOrReplace status and body", async () => {
    createOrReplaceMock.mockResolvedValue({
      ok: true,
      status: 201,
      body: {
        id: "n1",
        slug: "venue-picks",
        path: "/wiki/answers/venue-picks",
        pageUrl: "https://wiki.gdgs.jp/wiki/answers/venue-picks",
        created: true,
      },
    });
    const response = await action(
      actionArgs({
        slug: "venue-picks",
        title: "Venue picks",
        summary: "Compare halls.",
        content: "c".repeat(200),
        citedPaths: ["/wiki/venues/a", "/wiki/venues/b"],
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true, slug: "venue-picks" });
  });

  it("maps 409 slug_exists with path", async () => {
    createOrReplaceMock.mockResolvedValue({
      ok: false,
      error: "slug_exists",
      status: 409,
      path: "/wiki/answers/venue-picks",
    });
    const response = await action(
      actionArgs({
        slug: "venue-picks",
        title: "Venue picks",
        summary: "Compare halls.",
        content: "c".repeat(200),
        citedPaths: ["/wiki/venues/a", "/wiki/venues/b"],
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "slug_exists",
      path: "/wiki/answers/venue-picks",
    });
  });
});
