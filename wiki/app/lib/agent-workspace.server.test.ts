import { CHAPTERS_CLAIM, IS_ADMIN_CLAIM } from "@gdgjp/gdg-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createStoreMock = vi.fn<(...args: unknown[]) => unknown>();
const getDbMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ tag: "db" }));

vi.mock("~/lib/db.server", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

vi.mock("../../workers/features/ingestion/persistence/d1/wiki-read-repository", () => ({
  createD1WikiWorkspaceStore: (...args: unknown[]) => createStoreMock(...args),
}));

// Deliberately no `vi.mock("@gdgjp/gdg-lib", ...)` here: this file exercises the
// real getBearerIdentity implementation end to end (real /userinfo fetch, real
// claim parsing) rather than a stand-in, to prove the compatibility guarantee
// that any valid OAuth client token — including one issued to the `agents`
// client, which never carries the CLI scope (`SEEDED_SCOPES` in
// accounts/app/lib/seed-clients.server.ts) — still authenticates wiki's
// /api/agent/* and /api/cli/wiki/* surface through /userinfo.
import { resolveAgentWorkspace } from "./agent-workspace.server";

const ACCOUNTS_URL = "https://accounts.example";

function testEnv(): Env {
  return { ACCOUNTS_URL } as Env;
}

function requestWithAuth(authorization?: string): Request {
  return new Request("https://wiki.example/api/agent/ls?path=/wiki", {
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  createStoreMock.mockReset().mockReturnValue({ tag: "store" });
  getDbMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveAgentWorkspace with a real agents-client bearer token", () => {
  it("succeeds via /userinfo for a token that carries chapters/is_admin claims but no CLI scope", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`${ACCOUNTS_URL}/api/auth/oauth2/userinfo`);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer agents-client-issued-token",
      );
      return new Response(
        JSON.stringify({
          sub: "oidc-subject-1",
          email: "agent-linked-user@example.com",
          name: "Agent Linked User",
          [IS_ADMIN_CLAIM]: false,
          [CHAPTERS_CLAIM]: [{ chapterId: 10, chapterSlug: "osaka", role: "member" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveAgentWorkspace(
      requestWithAuth("Bearer agents-client-issued-token"),
      testEnv(),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(resolved).not.toBeNull();
    expect(resolved?.identity.user).toEqual({
      id: "oidc-subject-1",
      email: "agent-linked-user@example.com",
      name: "Agent Linked User",
      image: null,
      isAdmin: false,
    });
    expect(resolved?.identity.chapters).toEqual([
      { chapterId: 10, chapterSlug: "osaka", role: "member" },
    ]);
    expect(resolved?.chapterIds).toEqual(["10"]);
    expect(createStoreMock).toHaveBeenCalledWith(
      { tag: "db" },
      expect.objectContaining({ userId: "oidc-subject-1", isAdmin: false }),
    );
  });

  it("returns null without calling fetch when no Authorization header is present", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveAgentWorkspace(requestWithAuth(), testEnv());

    expect(resolved).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when accounts rejects the token (expired/revoked)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveAgentWorkspace(
      requestWithAuth("Bearer revoked-token"),
      testEnv(),
    );

    expect(resolved).toBeNull();
    expect(createStoreMock).not.toHaveBeenCalled();
  });
});
