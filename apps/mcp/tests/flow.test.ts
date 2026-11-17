import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { memoryKv } from "./memory-kv";

const APP = "http://localhost:5192";
const RESOURCE = `${APP}/mcp`;
const ACCOUNTS = "https://accounts.test";
const CLIENT_REDIRECT = "http://127.0.0.1:33418/callback";

type WikiCall = { url: URL; method: string; authorization: string | null; body: string };

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A tiny cookie jar: the consent and upstream helpers bind each step to the browser. */
class Browser {
  private cookies = new Map<string, string>();
  remember(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (!pair || index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (/max-age=0/i.test(header) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

let env: Env;
let wikiCalls: WikiCall[];
let accountsTokens: Array<{ grantType: string; refreshToken?: string }>;
let refreshResponse: () => Response;
let wikiResponder: (call: WikiCall) => Response;
const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  // Node's Request does not add Host; the Workers runtime always does.
  headers.set("host", new URL(APP).host);
  const request = new Request(`${APP}${path}`, { ...init, headers });
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], env, ctx);
}

beforeEach(() => {
  wikiCalls = [];
  accountsTokens = [];
  wikiResponder = () => Response.json({ query: "venue", pages: [], raw: [] });
  let issued = 0;
  refreshResponse = () => {
    issued += 1;
    return Response.json({
      access_token: `up-access-${issued + 1}`,
      refresh_token: `up-refresh-${issued + 1}`,
      expires_in: 3600,
    });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== ACCOUNTS) throw new Error(`unexpected fetch ${url}`);
      if (url.pathname === "/api/auth/oauth2/token") {
        expect(request.headers.get("authorization")).toBe(`Basic ${btoa("mcp:mcp-secret")}`);
        const form = new URLSearchParams(await request.text());
        const grantType = form.get("grant_type") ?? "";
        accountsTokens.push({ grantType, refreshToken: form.get("refresh_token") ?? undefined });
        if (grantType === "authorization_code") {
          expect(form.get("code")).toBe("accounts-code");
          expect(form.get("redirect_uri")).toBe(`${APP}/callback`);
          return Response.json({
            access_token: "up-access-1",
            refresh_token: "up-refresh-1",
            expires_in: 3600,
          });
        }
        return refreshResponse();
      }
      if (url.pathname === "/api/auth/oauth2/userinfo") {
        return Response.json({ sub: "user-1", email: "ada@example.com", name: "Ada" });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  env = {
    OAUTH_KV: memoryKv(),
    WIKI: {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const request = new Request(input, init);
        const wikiCall = {
          url: new URL(request.url),
          method: request.method,
          authorization: request.headers.get("authorization"),
          body: await request.text(),
        };
        wikiCalls.push(wikiCall);
        return wikiResponder(wikiCall);
      },
    } as unknown as Fetcher,
    APP_URL: APP,
    ACCOUNTS_URL: ACCOUNTS,
    WIKI_URL: "https://wiki.test",
    IDP_CLIENT_ID: "mcp",
    IDP_CLIENT_SECRET: "mcp-secret",
  };
});

afterEach(() => vi.unstubAllGlobals());

async function registerClient(): Promise<string> {
  const response = await call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Test <script>Client</script>",
      redirect_uris: [CLIENT_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Runs the whole browser leg and returns the MCP client's token response. */
async function authorize(ticked: string[]) {
  const clientId = await registerClient();
  const browser = new Browser();
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT,
    scope: "wiki:read wiki:write",
    state: "client-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });

  const consent = await call(`/authorize?${query}`);
  expect(consent.status).toBe(200);
  expect(consent.headers.get("x-frame-options")).toBe("DENY");
  browser.remember(consent);
  const page = await consent.text();
  expect(page).not.toContain("<script>Client");
  expect(page).toContain("&#60;script&#62;");
  const handle = /name="handle" value="([^"]+)"/.exec(page)?.[1];
  expect(handle).toBeTruthy();

  const form = new URLSearchParams({ handle: handle ?? "", decision: "approve" });
  for (const scope of ticked) form.append("scope", scope);
  const approved = await call("/authorize", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: browser.header(),
    },
    body: form,
  });
  expect(approved.status).toBe(302);
  browser.remember(approved);
  const upstream = new URL(approved.headers.get("location") ?? "");
  expect(upstream.origin + upstream.pathname).toBe(`${ACCOUNTS}/api/auth/oauth2/authorize`);
  expect(upstream.searchParams.get("client_id")).toBe("mcp");
  expect(upstream.searchParams.get("redirect_uri")).toBe(`${APP}/callback`);
  expect(upstream.searchParams.get("scope")).toContain("https://gdgs.jp/scopes/chapters");
  const state = upstream.searchParams.get("state") ?? "";

  const callback = await call(
    `/callback?${new URLSearchParams({ code: "accounts-code", state })}`,
    {
      headers: { cookie: browser.header() },
    },
  );
  expect(callback.status).toBe(302);
  const back = new URL(callback.headers.get("location") ?? "");
  expect(back.origin + back.pathname).toBe(CLIENT_REDIRECT);
  expect(back.searchParams.get("state")).toBe("client-state");
  const code = back.searchParams.get("code") ?? "";

  const token = await call("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CLIENT_REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  expect(token.status).toBe(200);
  const tokens = (await token.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };
  return { clientId, tokens };
}

async function mcp(accessToken: string, method: string, params: unknown = {}) {
  return call("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function rpcResult(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const payload = text.trim().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .pop();
  const message = JSON.parse(payload ?? "{}") as { result?: Record<string, unknown> };
  if (!message.result) throw new Error(`no result: ${text}`);
  return message.result;
}

describe("discovery", () => {
  it("challenges unauthenticated MCP requests with the resource metadata", async () => {
    const response = await mcp("", "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp"`,
    );

    const resource = await call("/.well-known/oauth-protected-resource/mcp");
    expect(await resource.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [APP],
      scopes_supported: ["wiki:read", "wiki:write"],
    });

    const metadata = (await (
      await call("/.well-known/oauth-authorization-server")
    ).json()) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      issuer: APP,
      authorization_endpoint: `${APP}/authorize`,
      token_endpoint: `${APP}/oauth/token`,
      registration_endpoint: `${APP}/oauth/register`,
    });
  });
});

describe("authorization through GDG Japan Accounts", () => {
  it("issues a token bound to the Accounts session and calls the wiki as the user", async () => {
    const { tokens } = await authorize(["wiki:read", "wiki:write"]);
    expect(tokens.scope.split(" ").sort()).toEqual(["wiki:read", "wiki:write"]);
    // Stays inside the upstream access token's lifetime.
    expect(tokens.expires_in).toBeLessThanOrEqual(3600 - 60);

    const list = await rpcResult(await mcp(tokens.access_token, "tools/list"));
    const names = (list.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toContain("wiki_search");
    expect(names).toContain("wiki_add_source");

    const result = await rpcResult(
      await mcp(tokens.access_token, "tools/call", {
        name: "wiki_search",
        arguments: { query: "venue", spaces: ["tokyo", "gdg-jp"] },
      }),
    );
    expect(result.isError).toBeFalsy();
    const wiki = wikiCalls.at(-1);
    expect(wiki?.authorization).toBe("Bearer up-access-1");
    expect(wiki?.url.origin).toBe("https://wiki.test");
    expect(wiki?.url.pathname).toBe("/api/agent/knowledge-search");
    expect(wiki?.url.searchParams.get("q")).toBe("venue");
    expect(wiki?.url.searchParams.get("space")).toBe("tokyo,gdg-jp");
  });

  it("refreshes the Accounts token whenever the MCP client refreshes", async () => {
    const { clientId, tokens } = await authorize(["wiki:read", "wiki:write"]);
    const refreshed = await call("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    expect(accountsTokens.at(-1)).toEqual({
      grantType: "refresh_token",
      refreshToken: "up-refresh-1",
    });

    await mcp(next.access_token, "tools/call", {
      name: "wiki_read_page",
      arguments: { space: "gdg-jp", slug: "venues" },
    });
    expect(wikiCalls.at(-1)?.authorization).toBe("Bearer up-access-2");
  });

  it("revokes the grant when Accounts no longer honours the refresh token", async () => {
    const { clientId, tokens } = await authorize(["wiki:read"]);
    refreshResponse = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    const refreshed = await call("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }),
    });
    expect(refreshed.status).toBe(400);
    expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
    expect((await mcp(tokens.access_token, "tools/list")).status).toBe(401);
  });

  it("asks a read-only token to step up before a write tool runs", async () => {
    const { tokens } = await authorize(["wiki:read"]);
    expect(tokens.scope).toBe("wiki:read");

    const read = await mcp(tokens.access_token, "tools/call", {
      name: "wiki_list_spaces",
      arguments: {},
    });
    expect(read.status).toBe(200);

    const write = await mcp(tokens.access_token, "tools/call", {
      name: "wiki_add_source",
      arguments: { url: "https://docs.google.com/document/d/x", visibility: "member" },
    });
    expect(write.status).toBe(403);
    expect(write.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(write.headers.get("www-authenticate")).toContain('scope="wiki:read wiki:write"');
    expect(wikiCalls.some((wiki) => wiki.url.pathname === "/api/agent/sources")).toBe(false);
  });

  it("sends the person back to the client when they deny", async () => {
    const clientId = await registerClient();
    const browser = new Browser();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CLIENT_REDIRECT,
      state: "s",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    const consent = await call(`/authorize?${query}`);
    browser.remember(consent);
    const handle = /name="handle" value="([^"]+)"/.exec(await consent.text())?.[1] ?? "";
    const denied = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: browser.header() },
      body: new URLSearchParams({ handle, decision: "deny" }),
    });
    expect(denied.status).toBe(302);
    const location = new URL(denied.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(accountsTokens).toHaveLength(0);
  });

  it("refuses a consent form posted without the browser's binding cookie", async () => {
    const clientId = await registerClient();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CLIENT_REDIRECT,
      state: "s",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    const consent = await call(`/authorize?${query}`);
    const handle = /name="handle" value="([^"]+)"/.exec(await consent.text())?.[1] ?? "";
    const forged = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle, decision: "approve" }),
    });
    expect(forged.status).toBe(400);
    expect(forged.headers.get("location")).toBeNull();
  });
});

describe("wiki tools", () => {
  async function tool(name: string, args: Record<string, unknown>) {
    const { tokens } = await authorize(["wiki:read", "wiki:write"]);
    const result = await rpcResult(
      await mcp(tokens.access_token, "tools/call", { name, arguments: args }),
    );
    return result as {
      isError?: boolean;
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    };
  }

  it("explains a rejected Accounts token instead of failing the call", async () => {
    wikiResponder = () => Response.json({ error: "invalid_token" }, { status: 401 });
    const result = await tool("wiki_list_spaces", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("接続し直してください");
    expect(result.content[0]?.text).toContain("wiki 401: invalid_token");
  });

  it("returns images from raw sources as image content", async () => {
    wikiResponder = () =>
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    const result = await tool("wiki_read_source", { documentId: "doc/1" });
    expect(wikiCalls.at(-1)?.url.pathname).toBe("/api/cli/wiki/sources/doc%2F1/content");
    expect(result.content[0]).toEqual({ type: "image", data: "iVBORw==", mimeType: "image/png" });
  });

  it("clips long text sources at maxChars", async () => {
    wikiResponder = () =>
      new Response("あ".repeat(50), { headers: { "content-type": "text/markdown" } });
    const result = await tool("wiki_read_source", { documentId: "doc-1", maxChars: 10 });
    expect(result.content[0]?.text?.startsWith("あ".repeat(10))).toBe(true);
    expect(result.content[0]?.text).toContain("10 文字で切りました");
  });

  it("filters the source manifest and defaults to the gdg-jp space", async () => {
    wikiResponder = () =>
      Response.json({
        version: 1,
        documents: [
          { documentId: "a", title: "Venue list", path: "raw/venues.md" },
          { documentId: "b", title: "Budget", path: "raw/budget.md" },
        ],
      });
    const result = await tool("wiki_list_sources", { query: "VENUE" });
    expect(wikiCalls.at(-1)?.url.searchParams.get("space")).toBe("gdg-jp");
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      total: 2,
      matched: 1,
      documents: [{ documentId: "a" }],
    });
  });

  it("reads AGENTS.md with its hash and updates it through sync", async () => {
    const hash = "a".repeat(64);
    wikiResponder = () =>
      new Response("# AGENTS", { headers: { "content-type": "text/markdown", etag: `"${hash}"` } });
    const read = await tool("wiki_get_agents_md", {});
    expect(JSON.parse(read.content[0]?.text ?? "{}")).toEqual({
      contentHash: hash,
      content: "# AGENTS",
    });

    wikiResponder = () => Response.json({ ok: true, pages: [] });
    await tool("wiki_update_agents_md", { content: "# New", expectedContentHash: hash });
    const sync = wikiCalls.at(-1);
    expect(sync?.method).toBe("POST");
    expect(sync?.url.pathname).toBe("/api/cli/wiki/sync");
    expect(JSON.parse(sync?.body ?? "{}")).toEqual({
      operations: [],
      agentsMd: { content: "# New", expectedContentHash: hash },
    });
  });

  it("registers a URL source in the requested space as the user", async () => {
    wikiResponder = () => Response.json({ id: "src-1", status: "pending" }, { status: 201 });
    await tool("wiki_add_source", {
      space: "tokyo",
      url: "https://docs.google.com/document/d/abc",
      visibility: "chapter-member",
      chapter: "12",
    });
    const sent = wikiCalls.at(-1);
    expect(sent?.url.pathname).toBe("/api/agent/sources");
    expect(sent?.url.searchParams.get("space")).toBe("tokyo");
    expect(sent?.authorization).toBe("Bearer up-access-1");
    expect(JSON.parse(sent?.body ?? "{}")).toEqual({
      url: "https://docs.google.com/document/d/abc",
      visibility: "chapter-member",
      chapter: "12",
    });
  });
});
