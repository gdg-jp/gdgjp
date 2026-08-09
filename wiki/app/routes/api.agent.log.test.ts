import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliIdentity } from "~/lib/cli-identity.server";

const getCliIdentityMock = vi.fn<(...args: unknown[]) => unknown>();
const createStoreMock = vi.fn<(...args: unknown[]) => unknown>();
const getDbMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ tag: "db" }));
const appendLogEntryMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("~/lib/cli-identity.server", () => ({
  getCliIdentity: (...args: unknown[]) => getCliIdentityMock(...args),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: (...args: unknown[]) => createStoreMock(...args),
}));

vi.mock("~/lib/wiki-catalog.server", () => ({
  appendLogEntry: (...args: unknown[]) => appendLogEntryMock(...args),
}));

import { action } from "./api.agent.log";

function identity(
  chapters: CliIdentity["chapters"] = [{ chapterId: 1, chapterSlug: "osaka", role: "member" }],
): CliIdentity {
  return {
    user: {
      id: "user-a",
      email: "a@example.com",
      name: "A",
      image: null,
      isAdmin: false,
    },
    chapters,
  };
}

function actionArgs(body: unknown) {
  const request = new Request("http://localhost/api/agent/log", {
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
    unstable_pattern: "/api/agent/log",
    unstable_url: new URL(request.url),
  };
}

beforeEach(() => {
  getCliIdentityMock.mockReset().mockResolvedValue(identity());
  createStoreMock.mockReset().mockReturnValue({ tag: "store" });
  getDbMock.mockClear();
  appendLogEntryMock.mockReset().mockResolvedValue({ ok: true });
});

describe("POST /api/agent/log", () => {
  it("returns 401 without calling append", async () => {
    getCliIdentityMock.mockResolvedValue(null);
    const response = await action(actionArgs({ subject: "q", lines: ["a"] }));
    expect(response.status).toBe(401);
    expect(appendLogEntryMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has no chapter membership", async () => {
    getCliIdentityMock.mockResolvedValue(identity([]));
    const response = await action(actionArgs({ subject: "q", lines: ["a"] }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "no_chapter_membership" });
    expect(appendLogEntryMock).not.toHaveBeenCalled();
  });

  it("returns 204 on success", async () => {
    const response = await action(actionArgs({ subject: "venue tips", lines: ["Cited /wiki/a"] }));
    expect(response.status).toBe(204);
    expect(appendLogEntryMock).toHaveBeenCalledWith(
      { tag: "env" },
      { subject: "venue tips", lines: ["Cited /wiki/a"], type: "query" },
    );
  });
});
