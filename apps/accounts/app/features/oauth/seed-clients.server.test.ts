import { describe, expect, it } from "vitest";
import { CHAPTERS_SCOPE, trustedOAuthClientIds } from "~/features/auth/auth.server";
import { collectSpecs, seedClients } from "~/features/oauth/seed-clients.server";

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

describe("collectSpecs mcp client", () => {
  it("seeds the MCP server as a confidential PKCE client with the chapters scope", () => {
    const specs = collectSpecs({
      ...agentsEnv({ AGENTS_CLIENT_SECRET: "" }),
      MCP_CLIENT_ID: "mcp",
      MCP_CLIENT_SECRET: "mcp-secret",
      MCP_REDIRECT_URLS: "https://mcp.gdgs.jp/callback",
    } as unknown as Env);
    expect(specs).toEqual([
      {
        clientId: "mcp",
        clientSecret: "mcp-secret",
        clientName: "GDG Japan MCP",
        redirectUris: ["https://mcp.gdgs.jp/callback"],
        requirePKCE: true,
        public: false,
        scopes: ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE],
      },
    ]);
  });
});

describe("collectSpecs every first-party client", () => {
  it("names each relying party and splits its comma-separated redirect URLs", () => {
    const apps = [
      ["TINYURL", "GDG Japan Links"],
      ["WIKI", "GDG Japan Wiki"],
      ["IMG", "GDG Japan Image"],
      ["SCHEDULER", "GDG Japan Scheduler"],
      ["SNS", "SNS Manager"],
      ["AGENTS", "GDG Japan Agents"],
      ["PAY", "GDG Japan Pay"],
      ["OST", "GDG Japan OST"],
      ["ROSTER", "GDG Japan Roster"],
      ["MC", "GDG Japan MC"],
      ["SCREEN", "GDG Japan Screen"],
      ["DECK", "GDG Japan Deck"],
      ["ROULETTE", "GDG Japan Roulette"],
      ["PR", "GDG Japan PR"],
      ["MCP", "GDG Japan MCP"],
      ["MEET", "GDG Japan Meet"],
    ] as const;
    const env = Object.fromEntries(
      apps.flatMap(([key]) => [
        [`${key}_CLIENT_ID`, key.toLowerCase()],
        [`${key}_CLIENT_SECRET`, `${key.toLowerCase()}-secret`],
        [`${key}_REDIRECT_URLS`, ` https://${key.toLowerCase()}.example/a , ,https://b.example/b `],
      ]),
    ) as unknown as Env;

    expect(
      collectSpecs(env).map(({ clientId, clientName, redirectUris }) => [
        clientId,
        clientName,
        redirectUris,
      ]),
    ).toEqual(
      apps.map(([key, name]) => [
        key.toLowerCase(),
        name,
        [`https://${key.toLowerCase()}.example/a`, "https://b.example/b"],
      ]),
    );
  });

  it("keeps a client with no redirect URLs so seeding can report it as skipped", () => {
    const [spec] = collectSpecs(agentsEnv({ AGENTS_REDIRECT_URLS: undefined }));
    expect(spec.redirectUris).toEqual([]);
  });
});

function recordingDb() {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return statement;
        },
        async run() {
          return { success: true };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, statements };
}

describe("seedClients agents client", () => {
  it("persists a confidential client_secret_basic PKCE client with a hashed secret", async () => {
    const { db, statements } = recordingDb();
    const result = await seedClients({
      ...agentsEnv({
        AGENTS_REDIRECT_URLS: "https://agent.gdgs.jp/auth/callback,https://agent.example/cb",
      }),
      DB: db,
    } as unknown as Env);

    expect(result).toEqual({ written: ["agents"], skipped: [] });
    const [{ sql, values }] = statements;
    expect(sql).toContain("'client_secret_basic', ?, ?, 'web', ?, 'web', ?)");
    expect(sql).toContain("tokenEndpointAuthMethod = excluded.tokenEndpointAuthMethod");
    expect(sql).toContain("public = excluded.public");
    expect(sql).toContain("requirePKCE = excluded.requirePKCE");
    expect(values.slice(1)).toEqual([
      "agents",
      "BylE0sLyp8XtK55lnCx2zH_JnkiEbAzKnVsE-NeiGwM",
      JSON.stringify(["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE]),
      expect.any(String),
      values[4],
      "GDG Japan Agents",
      JSON.stringify(["https://agent.gdgs.jp/auth/callback", "https://agent.example/cb"]),
      JSON.stringify(["https://agent.gdgs.jp/signin", "https://agent.example/signin"]),
      JSON.stringify(["authorization_code", "refresh_token"]),
      JSON.stringify(["code"]),
      0,
      1,
    ]);
  });

  it("skips clients without redirect URLs instead of writing them", async () => {
    const { db, statements } = recordingDb();
    const result = await seedClients({
      ...agentsEnv({ AGENTS_REDIRECT_URLS: "" }),
      DB: db,
    } as unknown as Env);
    expect(result).toEqual({ written: [], skipped: ["agents"] });
    expect(statements).toEqual([]);
  });
});

describe("trustedOAuthClientIds", () => {
  it("lists exactly the configured consent-skip trusted clients", () => {
    expect(
      trustedOAuthClientIds({
        ...agentsEnv(),
        TINYURL_CLIENT_ID: "tinyurl",
        WIKI_CLIENT_ID: "wiki",
        IMG_CLIENT_ID: "img",
        SCHEDULER_CLIENT_ID: "scheduler",
        SNS_CLIENT_ID: "sns",
        PAY_CLIENT_ID: "pay",
        MCP_CLIENT_ID: "mcp",
      } as unknown as Env),
    ).toEqual(["tinyurl", "wiki", "img", "scheduler", "sns", "agents", "pay", "mcp"]);
    expect(trustedOAuthClientIds(agentsEnv())).toEqual(["agents"]);
  });
});
