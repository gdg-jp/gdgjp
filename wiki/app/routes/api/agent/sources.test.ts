import type { BearerIdentity } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBearerIdentityMock = vi.fn<(...args: unknown[]) => unknown>();
const createStoreMock = vi.fn<(...args: unknown[]) => unknown>();
const getDbMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ tag: "db" }));
const createSourceMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@gdgjp/gdg-lib", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gdgjp/gdg-lib")>();
  return {
    ...original,
    getBearerIdentity: (...args: unknown[]) => getBearerIdentityMock(...args),
  };
});

vi.mock("~/lib/db.server", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: (...args: unknown[]) => createStoreMock(...args),
}));

vi.mock("~/lib/sources.server", () => ({
  createSource: (...args: unknown[]) => createSourceMock(...args),
}));

import { action } from "./sources";

function identity(): BearerIdentity {
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
  getBearerIdentityMock.mockReset().mockResolvedValue(identity());
  createStoreMock.mockReset().mockReturnValue({ tag: "store" });
  getDbMock.mockClear();
  createSourceMock.mockReset();
});

describe("POST /api/agent/sources", () => {
  it("returns 401 invalid_token without calling createSource or the store", async () => {
    getBearerIdentityMock.mockResolvedValue(null);
    const response = await action(actionArgs({ url: "https://example.com", chapter: "1" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(createSourceMock).not.toHaveBeenCalled();
    expect(createStoreMock).not.toHaveBeenCalled();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_visibility and creates no row when visibility is missing", async () => {
    createSourceMock.mockResolvedValue({
      ok: false,
      error: "invalid_visibility",
      status: 400,
    });
    const response = await action(actionArgs({ url: "https://example.com" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_visibility" });
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ visibility: undefined, url: "https://example.com" }),
    );
  });

  it("returns 403 forbidden_chapter when the caller cannot assign the chapter", async () => {
    createSourceMock.mockResolvedValue({
      ok: false,
      error: "forbidden_chapter",
      status: 403,
    });
    const response = await action(
      actionArgs({ url: "https://example.com", visibility: "chapter-member", chapter: "999" }),
    );
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
      visibility: "chapter-member",
      status: "pending",
      refreshPolicy: "manual",
    };
    createSourceMock.mockResolvedValue({ ok: true, source });
    const response = await action(
      actionArgs({
        url: "https://example.com",
        visibility: "chapter-member",
        chapter: "1",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(source);
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        url: "https://example.com",
        visibility: "chapter-member",
        chapter: "1",
        user: identity().user,
        chapters: identity().chapters,
      }),
    );
  });
});
