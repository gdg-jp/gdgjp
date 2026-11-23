import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { refuseDeveloperClientResource } from "~/features/oauth/developer-client-resource.server";

const ORIGIN = "https://accounts.example";
const RESOURCE = `${ORIGIN}/api/auth/oauth2/userinfo`;
const DEV_REDIRECT = "https://dev.example/callback?app=1";

function testEnv() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).sort()) {
    raw.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  raw.exec(`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Owner', 'o@example.com')`);
  raw
    .prepare(`INSERT INTO "oauthClient" (id, "clientId", "redirectUris", "userId") VALUES
      ('c1', 'dev:app', ?, 'owner'),
      ('c2', 'fp-wiki', '["https://wiki.example/callback"]', NULL),
      ('c3', 'dev-broken', 'not json', 'owner'),
      ('c4', 'dev-string', ?, 'owner')`)
    .run(JSON.stringify([DEV_REDIRECT]), JSON.stringify(DEV_REDIRECT));
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => raw.prepare(sql).all(...params)[0] ?? null,
  });
  return {
    DB: { prepare: (sql: string) => statement(sql) } as unknown as D1Database,
    APP_URL: ORIGIN,
  };
}

function authorize(params: Record<string, string | string[]>, init: RequestInit = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of [value].flat()) query.append(key, item);
  }
  return new Request(`${ORIGIN}/api/auth/oauth2/authorize?${query}`, init);
}

function basic(clientId: string) {
  return `Basic ${btoa(`${encodeURIComponent(clientId)}:secret`)}`;
}

function tokenForm(form: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form).toString(),
  });
}

async function expectInvalidTarget(response: Response | null) {
  expect(response?.status).toBe(400);
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  expect(response?.headers.get("Pragma")).toBe("no-cache");
  await expect(response?.json()).resolves.toEqual({
    error: "invalid_target",
    error_description: "resource indicators are not available to developer-owned clients",
  });
}

describe("refuseDeveloperClientResource at the authorization endpoint", () => {
  it("redirects a developer client's resource request back with invalid_target", async () => {
    const response = await refuseDeveloperClientResource(
      testEnv(),
      authorize({
        client_id: "dev:app",
        redirect_uri: DEV_REDIRECT,
        resource: RESOURCE,
        state: "s 1",
      }),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    const location = new URL(response?.headers.get("Location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe("https://dev.example/callback");
    expect(Object.fromEntries(location.searchParams)).toEqual({
      app: "1",
      error: "invalid_target",
      error_description: "resource indicators are not available to developer-owned clients",
      state: "s 1",
      iss: ORIGIN,
    });
  });

  it("omits an absent state and refuses an empty resource value", async () => {
    const response = await refuseDeveloperClientResource(
      testEnv(),
      authorize({ client_id: "dev:app", redirect_uri: DEV_REDIRECT, resource: "" }),
    );

    const location = new URL(response?.headers.get("Location") ?? "");
    expect(location.searchParams.has("state")).toBe(false);
    expect(location.searchParams.get("error")).toBe("invalid_target");
  });

  it.each([
    [{ redirect_uri: "https://evil.example/callback" }],
    [{ redirect_uri: `${DEV_REDIRECT}&x=1` }],
    [{}],
  ])("answers in the body when the redirect URI %o is not registered", async (extra) => {
    await expectInvalidTarget(
      await refuseDeveloperClientResource(
        testEnv(),
        authorize({ client_id: "dev:app", resource: RESOURCE, ...extra }),
      ),
    );
  });

  it.each(["dev-broken", "dev-string"])(
    "answers in the body for %s, whose redirect URIs are not a list",
    async (clientId) => {
      await expectInvalidTarget(
        await refuseDeveloperClientResource(
          testEnv(),
          authorize({ client_id: clientId, redirect_uri: DEV_REDIRECT, resource: RESOURCE }),
        ),
      );
    },
  );

  it("finds the resource and client in a form-encoded POST body", async () => {
    const request = new Request(`${ORIGIN}/api/auth/oauth2/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "dev:app",
        redirect_uri: DEV_REDIRECT,
        resource: RESOURCE,
        state: "posted",
      }).toString(),
    });

    const response = await refuseDeveloperClientResource(testEnv(), request);

    const location = new URL(response?.headers.get("Location") ?? "");
    expect(location.searchParams.get("state")).toBe("posted");
    await expect(request.text()).resolves.toContain("client_id=dev%3Aapp");
  });

  it("refuses a POST whose resource is in the query and client in the body", async () => {
    const request = new Request(
      `${ORIGIN}/api/auth/oauth2/authorize?resource=${encodeURIComponent(RESOURCE)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: "dev:app" }).toString(),
      },
    );

    await expectInvalidTarget(await refuseDeveloperClientResource(testEnv(), request));
  });

  it.each([
    ["a first-party client", { client_id: "fp-wiki", resource: RESOURCE }],
    ["the gdg CLI", { client_id: "gdg-cli", resource: RESOURCE }],
    ["an unknown client", { client_id: "missing", resource: RESOURCE }],
    ["no client", { resource: RESOURCE }],
    ["a developer client without a resource", { client_id: "dev:app" }],
  ])("lets %s through", async (_name, params) => {
    await expect(
      refuseDeveloperClientResource(
        testEnv(),
        authorize({ redirect_uri: DEV_REDIRECT, ...params }),
      ),
    ).resolves.toBeNull();
  });
});

describe("refuseDeveloperClientResource at the token endpoint", () => {
  it("refuses a developer client named by its Basic credentials", async () => {
    const request = tokenForm(
      { grant_type: "authorization_code", code: "c", resource: RESOURCE },
      { Authorization: basic("dev:app") },
    );

    await expectInvalidTarget(await refuseDeveloperClientResource(testEnv(), request));
  });

  it("refuses a developer client named in the body, whatever the Basic header says", async () => {
    await expectInvalidTarget(
      await refuseDeveloperClientResource(
        testEnv(),
        tokenForm(
          { grant_type: "refresh_token", client_id: "dev:app", resource: RESOURCE },
          { Authorization: basic("fp-wiki") },
        ),
      ),
    );
  });

  it("refuses a resource in a JSON body and in a multipart body", async () => {
    const json = new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: "dev:app",
        resource: [RESOURCE],
      }),
    });
    const form = new FormData();
    form.set("grant_type", "refresh_token");
    form.set("resource", new Blob(["x"]), "resource.txt");
    const multipart = new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { Authorization: basic("dev:app") },
      body: form,
    });

    await expectInvalidTarget(await refuseDeveloperClientResource(testEnv(), json));
    await expectInvalidTarget(await refuseDeveloperClientResource(testEnv(), multipart));
    await expect(json.json()).resolves.toMatchObject({ client_id: "dev:app" });
  });

  it("reads a structured JSON media type and a JSON null body", async () => {
    const vendor = new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/vnd.example+json" },
      body: JSON.stringify({ client_id: "dev:app", resource: RESOURCE }),
    });
    const empty = new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: basic("dev:app") },
      body: "null",
    });

    await expectInvalidTarget(await refuseDeveloperClientResource(testEnv(), vendor));
    await expect(refuseDeveloperClientResource(testEnv(), empty)).resolves.toBeNull();
  });

  it("names a developer client whose Basic value has no separator", async () => {
    await expectInvalidTarget(
      await refuseDeveloperClientResource(
        testEnv(),
        tokenForm(
          { grant_type: "refresh_token", resource: RESOURCE },
          { Authorization: `Basic ${btoa("dev-broken")}` },
        ),
      ),
    );
  });

  it.each([
    ["an undecodable Basic value", "Basic !!"],
    ["another scheme", `Bearer basic ${btoa("fp-wiki:secret")}`],
  ])("refuses a resource when no client can be identified: %s", async (_name, authorization) => {
    await expectInvalidTarget(
      await refuseDeveloperClientResource(
        testEnv(),
        tokenForm(
          { grant_type: "refresh_token", resource: RESOURCE },
          { Authorization: authorization },
        ),
      ),
    );
  });

  it.each([
    ["a first-party client", { Authorization: basic("fp-wiki") }],
    ["the gdg CLI", { Authorization: basic("gdg-cli") }],
    ["an unknown client", { Authorization: basic("missing") }],
    ["a Basic value without a separator", { Authorization: `Basic ${btoa("fp-wiki")}` }],
    ["an undecodable client id", { Authorization: `Basic ${btoa("%E0%A4%A:secret")}` }],
    ["a Basic scheme with extra spaces", { Authorization: `basic   ${btoa("fp-wiki:secret")}` }],
  ])("lets %s through", async (_name, headers) => {
    await expect(
      refuseDeveloperClientResource(
        testEnv(),
        tokenForm({ grant_type: "refresh_token", resource: RESOURCE }, headers),
      ),
    ).resolves.toBeNull();
  });

  it.each([
    [
      "a developer client without a resource",
      tokenForm({ grant_type: "refresh_token" }, { Authorization: basic("dev:app") }),
    ],
    [
      "a GET request",
      new Request(`${ORIGIN}/api/auth/oauth2/token?resource=x&client_id=dev%3Aapp`),
    ],
    [
      "an unreadable JSON body",
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: basic("dev:app") },
        body: "{",
      }),
    ],
    [
      "a JSON body that is not an object",
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: basic("dev:app") },
        body: JSON.stringify(["resource"]),
      }),
    ],
    [
      "a body whose media type only mentions JSON",
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "text/x.application/json", Authorization: basic("dev:app") },
        body: JSON.stringify({ resource: RESOURCE }),
      }),
    ],
    [
      "a body without a media type",
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { Authorization: basic("dev:app") },
        body: new Blob([`resource=${RESOURCE}`]),
      }),
    ],
    [
      "a body of another media type",
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "text/plain", Authorization: basic("dev:app") },
        body: `resource=${RESOURCE}`,
      }),
    ],
    [
      "another endpoint",
      new Request(`${ORIGIN}/api/auth/oauth2/introspect`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          Authorization: basic("dev:app"),
        },
        body: `resource=${encodeURIComponent(RESOURCE)}`,
      }),
    ],
  ])("lets %s through", async (_name, request) => {
    await expect(refuseDeveloperClientResource(testEnv(), request)).resolves.toBeNull();
  });
});
