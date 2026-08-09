import { describe, expect, it } from "vitest";
import { CHAPTERS_SCOPE, trustedOAuthClientIds } from "./auth.server";
import { collectSpecs, seedClients } from "./seed-clients.server";

function agentsEnv(
  overrides: Partial<{
    AGENTS_CLIENT_ID: string;
    AGENTS_CLIENT_SECRET: string;
    AGENTS_REDIRECT_URLS: string;
  }> = {},
): Env {
  return {
    TINYURL_CLIENT_ID: "",
    WIKI_CLIENT_ID: "",
    IMG_CLIENT_ID: "",
    SCHEDULER_CLIENT_ID: "",
    SNS_CLIENT_ID: "",
    AGENTS_CLIENT_ID: "agents",
    AGENTS_CLIENT_SECRET: "agents-secret",
    AGENTS_REDIRECT_URLS: "https://agent.gdgs.jp/auth/callback",
    ...overrides,
  } as unknown as Env;
}

describe("collectSpecs agents client", () => {
  it("returns a confidential PKCE client with offline_access and chapters scope", () => {
    const [spec] = collectSpecs(agentsEnv());
    expect(spec).toEqual({
      clientId: "agents",
      clientSecret: "agents-secret",
      clientName: "GDG Japan Agents",
      redirectUris: ["https://agent.gdgs.jp/auth/callback"],
      requirePKCE: true,
      public: false,
      scopes: ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE],
    });
  });

  it("omits the agents spec when the secret is missing", () => {
    const specs = collectSpecs(agentsEnv({ AGENTS_CLIENT_SECRET: "" }));
    expect(specs).toEqual([]);
  });
});

describe("seedClients agents client", () => {
  it("persists the confidential PKCE policy and required scopes", async () => {
    let preparedSql = "";
    let boundValues: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        boundValues = values;
        return statement;
      },
      async run() {
        return { success: true };
      },
    };
    const prepare = (sql: string) => {
      preparedSql = sql;
      return statement;
    };

    const result = await seedClients({
      ...agentsEnv(),
      DB: { prepare },
    } as unknown as Env);

    expect(result).toEqual({ written: ["agents"], skipped: [] });
    expect(preparedSql).toContain("?, 'web', ?");
    expect(preparedSql).toContain("public = excluded.public");
    expect(preparedSql).toContain("requirePKCE = excluded.requirePKCE");
    expect(boundValues.at(-2)).toBe(0);
    expect(boundValues.at(-1)).toBe(1);
    expect(JSON.parse(String(boundValues[3]))).toEqual([
      "openid",
      "email",
      "profile",
      "offline_access",
      CHAPTERS_SCOPE,
    ]);
  });
});

describe("trustedOAuthClientIds", () => {
  it("includes agents among the consent-skip trusted clients", () => {
    expect(trustedOAuthClientIds(agentsEnv())).toContain("agents");
  });
});
