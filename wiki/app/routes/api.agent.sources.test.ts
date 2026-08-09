import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliIdentity } from "~/lib/cli-identity.server";

const getCliIdentityMock = vi.fn<(...args: unknown[]) => unknown>();
const createStoreMock = vi.fn<(...args: unknown[]) => unknown>();
const getDbMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ tag: "db" }));
const createSourceMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("~/lib/cli-identity.server", () => ({
  getCliIdentity: (...args: unknown[]) => getCliIdentityMock(...args),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: (...args: unknown[]) => createStoreMock(...args),
}));

vi.mock("~/lib/sources.server", () => ({
  createSource: (...args: unknown[]) => createSourceMock(...args),
}));

import { action } from "./api.agent.sources";

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
  const request = new Request("http://localhost/api/agent/sources", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    request,
    context: { cloudflare: { env: { tag: "env" } } } as never,
    params: {},
    unstable_pattern: "/api/agent/sources",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getCliIdentityMock.mockReset().mockResolvedValue(identity());
  createStoreMock.mockReset().mockReturnValue({ tag: "store" });
  getDbMock.mockClear();
  createSourceMock.mockReset();
});

describe("POST /api/agent/sources", () => {
  it("returns 401 invalid_token without calling createSource or the store", async () => {
    getCliIdentityMock.mockResolvedValue(null);
    const response = await action(actionArgs({ url: "https://example.com", chapter: "1" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(createSourceMock).not.toHaveBeenCalled();
    expect(createStoreMock).not.toHaveBeenCalled();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("returns 400 chapter_required and creates no row when chapter is missing", async () => {
    createSourceMock.mockResolvedValue({
      ok: false,
      error: "chapter_required",
      status: 400,
    });
    const response = await action(actionArgs({ url: "https://example.com" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "chapter_required" });
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chapter: undefined, url: "https://example.com" }),
    );
  });

  it("returns 403 forbidden_chapter when the caller cannot assign the chapter", async () => {
    createSourceMock.mockResolvedValue({
      ok: false,
      error: "forbidden_chapter",
      status: 403,
    });
    const response = await action(actionArgs({ url: "https://example.com", chapter: "999" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden_chapter" });
  });

  it("returns 201 with the created source on success", async () => {
    const source = {
      id: "src-1",
      kind: "website",
      url: "https://example.com",
      title: "example.com",
      chapterId: "1",
      status: "pending",
      refreshPolicy: "manual",
    };
    createSourceMock.mockResolvedValue({ ok: true, source });
    const response = await action(actionArgs({ url: "https://example.com", chapter: "1" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(source);
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        url: "https://example.com",
        chapter: "1",
        user: identity().user,
        chapterIds: ["1"],
      }),
    );
  });
});
