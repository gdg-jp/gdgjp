import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  formParameters,
  refuseDeveloperClientResource,
} from "~/features/oauth/developer-client-resource.server";

const ORIGIN = "https://accounts.example";
const RESOURCE = `${ORIGIN}/api/auth/oauth2/userinfo`;
const DEV_REDIRECT = "https://dev.example/callback?app=1";
const FP_REDIRECT = "https://wiki.example/callback";
const REFUSAL = "resource indicators are available only to first-party clients";
const FORM = "application/x-www-form-urlencoded";

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
      ('c2', 'fp-wiki', ?, NULL),
      ('c3', 'dev-broken', 'not json', 'owner'),
      ('c4', 'dev-string', ?, 'owner'),
      ('c5', 'dev app', ?, 'owner'),
      ('c6', 'dév', ?, 'owner')`)
    .run(
      JSON.stringify([DEV_REDIRECT]),
      JSON.stringify([FP_REDIRECT]),
      JSON.stringify(DEV_REDIRECT),
      JSON.stringify([DEV_REDIRECT]),
      JSON.stringify([DEV_REDIRECT]),
    );
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => raw.prepare(sql).all(...params)[0] ?? null,
  });
  return {
    DB: { prepare: (sql: string) => statement(sql) } as unknown as D1Database,
    APP_URL: ORIGIN,
  };
}

function query(params: Record<string, string | string[]>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of [value].flat()) search.append(key, item);
  }
  return search;
}

function authorize(params: Record<string, string | string[]>) {
  return new Request(`${ORIGIN}/api/auth/oauth2/authorize?${query(params)}`);
}

function postAuthorize(
  body: Record<string, string | string[]>,
  urlParams: Record<string, string | string[]> = {},
  contentType = FORM,
) {
  return new Request(`${ORIGIN}/api/auth/oauth2/authorize?${query(urlParams)}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: query(body).toString(),
  });
}

function basic(credentials: string, encoding: "base64" | "base64url" = "base64") {
  return `Basic ${Buffer.from(credentials).toString(encoding)}`;
}

function tokenForm(form: Record<string, string | string[]>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": FORM, ...headers },
    body: query(form).toString(),
  });
}

function refreshWithResource(form: Record<string, string | string[]> = {}) {
  return { grant_type: "refresh_token", refresh_token: "r", resource: RESOURCE, ...form };
}

async function expectInvalidTarget(response: Response | null) {
  expect(response?.status).toBe(400);
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  expect(response?.headers.get("Pragma")).toBe("no-cache");
  await expect(response?.json()).resolves.toEqual({
    error: "invalid_target",
    error_description: REFUSAL,
  });
}

function redirected(response: Response | null) {
  expect(response?.status).toBe(302);
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  return new URL(response?.headers.get("Location") ?? "");
}

describe("formParameters", () => {
  it.each([
    FORM,
    "Application/X-WWW-Form-URLEncoded",
    "application/x-www-form-urlencoded ;charset=UTF-8",
  ])("reads a form body sent as %s and leaves the request readable", async (contentType) => {
    const request = new Request(ORIGIN, {
      method: "POST",
      headers: { "content-type": contentType },
      body: "a=1&a=2",
    });

    await expect(formParameters(request)).resolves.toEqual(new URLSearchParams("a=1&a=2"));
    await expect(request.text()).resolves.toBe("a=1&a=2");
  });

  it.each([
    ["JSON", { "content-type": "application/json" }],
    ["a media type that only mentions the form type", { "content-type": `text/x.${FORM}` }],
    ["a media type that extends the form type", { "content-type": `${FORM}-x` }],
    ["no media type", {}],
  ])("ignores a body sent as %s, which Better Auth refuses", async (_name, headers) => {
    const request = new Request(ORIGIN, { method: "POST", headers, body: "a=1" });

    await expect(formParameters(request)).resolves.toEqual(new URLSearchParams());
  });
});

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

    const location = redirected(response);
    expect(`${location.origin}${location.pathname}`).toBe("https://dev.example/callback");
    expect(Object.fromEntries(location.searchParams)).toEqual({
      app: "1",
      error: "invalid_target",
      error_description: REFUSAL,
      state: "s 1",
      iss: ORIGIN,
    });
  });

  it("omits an absent or repeated state and refuses an empty resource value", async () => {
    for (const state of [[], ["a", "b"], [""]]) {
      const location = redirected(
        await refuseDeveloperClientResource(
          testEnv(),
          authorize({ client_id: "dev:app", redirect_uri: DEV_REDIRECT, resource: "", state }),
        ),
      );
      expect(location.searchParams.has("state")).toBe(false);
      expect(location.searchParams.get("error")).toBe("invalid_target");
    }
  });

  it("refuses an absent or repeated client_id without asking the database", async () => {
    const env = {
      DB: {
        prepare: () => {
          throw new Error("no query expected");
        },
      } as unknown as D1Database,
      APP_URL: ORIGIN,
    };
    for (const client_id of [[], ["dev:app", "fp-wiki"]]) {
      await expectInvalidTarget(
        await refuseDeveloperClientResource(
          env,
          authorize({ client_id, redirect_uri: DEV_REDIRECT, resource: RESOURCE }),
        ),
      );
    }
  });

  it.each([
    [{ redirect_uri: "https://evil.example/callback" }],
    [{ redirect_uri: `${DEV_REDIRECT}&x=1` }],
    [{ redirect_uri: [DEV_REDIRECT, DEV_REDIRECT] }],
    [{}],
  ])("answers in the body when the redirect URI %o is not one registered URI", async (extra) => {
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

  it.each([
    ["an unknown client", { client_id: "missing" }],
    ["no client", {}],
    ["an empty client", { client_id: "" }],
    ["two clients", { client_id: ["fp-wiki", "fp-wiki"] }],
  ])("answers in the body for %s, which is not known to be first-party", async (_name, extra) => {
    await expectInvalidTarget(
      await refuseDeveloperClientResource(
        testEnv(),
        authorize({ redirect_uri: FP_REDIRECT, resource: RESOURCE, ...extra }),
      ),
    );
  });

  it.each([
    ["a first-party client", { client_id: "fp-wiki", resource: RESOURCE }],
    ["the gdg CLI", { client_id: "gdg-cli", resource: RESOURCE }],
    ["a developer client without a resource", { client_id: "dev:app" }],
  ])("lets %s through", async (_name, params) => {
    await expect(
      refuseDeveloperClientResource(testEnv(), authorize({ redirect_uri: FP_REDIRECT, ...params })),
    ).resolves.toBeNull();
  });

  it("reads a POST from its form body and leaves the body for Better Auth", async () => {
    const request = postAuthorize({
      client_id: "dev:app",
      redirect_uri: DEV_REDIRECT,
      resource: RESOURCE,
      state: "posted",
    });

    const location = redirected(await refuseDeveloperClientResource(testEnv(), request));

    expect(location.searchParams.get("state")).toBe("posted");
    await expect(request.text()).resolves.toContain("client_id=dev%3Aapp");
  });

  it("ignores stale developer parameters in a first-party POST's URL", async () => {
    const request = postAuthorize(
      { client_id: "fp-wiki", redirect_uri: FP_REDIRECT, state: "fp" },
      { client_id: "dev:app", redirect_uri: DEV_REDIRECT, resource: RESOURCE, state: "stale" },
    );

    await expect(refuseDeveloperClientResource(testEnv(), request)).resolves.toBeNull();
  });

  it("refuses a developer POST from its body alone, whatever the URL says", async () => {
    const request = postAuthorize(
      { client_id: "dev:app", redirect_uri: DEV_REDIRECT, resource: RESOURCE, state: "body" },
      { client_id: "fp-wiki", redirect_uri: FP_REDIRECT, state: "url" },
    );

    const location = redirected(await refuseDeveloperClientResource(testEnv(), request));

    expect(`${location.origin}${location.pathname}`).toBe("https://dev.example/callback");
    expect(location.searchParams.get("state")).toBe("body");
  });

  it("lets a POST through when its body is not a form, which Better Auth refuses", async () => {
    const request = postAuthorize(
      { client_id: "dev:app", redirect_uri: DEV_REDIRECT, resource: RESOURCE },
      {},
      "text/plain",
    );

    await expect(refuseDeveloperClientResource(testEnv(), request)).resolves.toBeNull();
  });
});

describe("refuseDeveloperClientResource at the token endpoint", () => {
  it.each([
    ["Basic credentials", basic("dev%3Aapp:secret"), {}],
    ["base64url Basic credentials", basic("dev%3Aapp:??", "base64url"), {}],
    [
      "base64url Basic credentials beside a first-party body client_id",
      basic("dev%3Aapp:??", "base64url"),
      { client_id: "fp-wiki" },
    ],
    ["a form-encoded space in Basic credentials", basic("dev+app:secret"), {}],
    ["UTF-8 Basic credentials", basic("dév:secret"), {}],
    ["the body", null, { client_id: "dev:app" }],
    ["the body beside an empty client_id", null, { client_id: ["", "dev:app"] }],
  ])("refuses a developer client named by %s", async (_name, authorization, form) => {
    await refuseDeveloperClientResourceWith(authorization, form, false);
  });

  it.each([
    ["Basic credentials", basic("fp-wiki:secret"), {}],
    ["Basic credentials and the same body client_id", basic("fp-wiki:s"), { client_id: "fp-wiki" }],
    ["a Basic scheme with extra spaces", `basic   ${btoa("fp-wiki:secret")}`, {}],
    ["the body", null, { client_id: "fp-wiki" }],
    ["the body beside an empty client_id", null, { client_id: ["fp-wiki", ""] }],
    ["the body with an empty Authorization header", "", { client_id: "fp-wiki" }],
    ["the gdg CLI", null, { client_id: "gdg-cli" }],
  ])("lets a first-party client named by %s through", async (_name, authorization, form) => {
    await refuseDeveloperClientResourceWith(authorization, form, true);
  });

  it.each([
    ["Basic and body naming different clients", basic("fp-wiki:s"), { client_id: "dev:app" }],
    ["two body clients", null, { client_id: ["fp-wiki", "fp-wiki"] }],
    ["a client assertion", null, { client_id: "fp-wiki", client_assertion: "x" }],
    ["a client assertion type", null, { client_id: "fp-wiki", client_assertion_type: "x" }],
    ["an undecodable Basic value", "Basic !!", {}],
    ["a Basic value without a separator", basic("fp-wiki"), {}],
    ["a Basic value with an empty secret", basic("fp-wiki:"), {}],
    ["a Basic scheme followed by a tab", `Basic\t${btoa("fp-wiki:secret")}`, {}],
    ["another scheme", `Bearer basic ${btoa("fp-wiki:secret")}`, { client_id: "fp-wiki" }],
    ["an unknown client", basic("missing:secret"), {}],
    ["no client", null, {}],
  ])("refuses a resource when %s", async (_name, authorization, form) => {
    await refuseDeveloperClientResourceWith(authorization, form, false);
  });

  it("leaves the body for Better Auth", async () => {
    const request = tokenForm(refreshWithResource(), { Authorization: basic("dev%3Aapp:s") });

    await expectInvalidTarget(await refuseDeveloperClientResource(testEnv(), request));
    await expect(request.text()).resolves.toContain("grant_type=refresh_token");
  });

  it.each([
    [
      "a developer client without a resource",
      tokenForm({ grant_type: "refresh_token" }, { Authorization: basic("dev%3Aapp:s") }),
    ],
    [
      "a GET request",
      new Request(`${ORIGIN}/api/auth/oauth2/token?resource=x&client_id=dev%3Aapp`),
    ],
    [
      "a JSON body, which Better Auth refuses",
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: basic("dev%3Aapp:s") },
        body: JSON.stringify({ resource: RESOURCE }),
      }),
    ],
    [
      "another endpoint",
      new Request(`${ORIGIN}/api/auth/oauth2/introspect`, {
        method: "POST",
        headers: { "content-type": FORM, Authorization: basic("dev%3Aapp:s") },
        body: `resource=${encodeURIComponent(RESOURCE)}`,
      }),
    ],
  ])("lets %s through", async (_name, request) => {
    await expect(refuseDeveloperClientResource(testEnv(), request)).resolves.toBeNull();
  });
});

async function refuseDeveloperClientResourceWith(
  authorization: string | null,
  form: Record<string, string | string[]>,
  passes: boolean,
) {
  const headers: Record<string, string> =
    authorization === null ? {} : { Authorization: authorization };
  const response = await refuseDeveloperClientResource(
    testEnv(),
    tokenForm(refreshWithResource(form), headers),
  );
  if (passes) expect(response).toBeNull();
  else await expectInvalidTarget(response);
}
