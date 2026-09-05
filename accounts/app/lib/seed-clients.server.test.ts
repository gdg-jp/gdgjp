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

describe("collectSpecs discord-relay client", () => {
  function discordRelayEnv(
    overrides: Partial<{
      DISCORD_RELAY_CLIENT_ID: string;
      DISCORD_RELAY_CLIENT_SECRET: string;
      DISCORD_RELAY_REDIRECT_URLS: string;
    }> = {},
  ): Env {
    return {
      TINYURL_CLIENT_ID: "",
      WIKI_CLIENT_ID: "",
      IMG_CLIENT_ID: "",
      SCHEDULER_CLIENT_ID: "",
      SNS_CLIENT_ID: "",
      AGENTS_CLIENT_ID: "",
      PAY_CLIENT_ID: "",
      OST_CLIENT_ID: "",
      DISCORD_RELAY_CLIENT_ID: "discord-relay",
      DISCORD_RELAY_CLIENT_SECRET: "discord-relay-secret",
      DISCORD_RELAY_REDIRECT_URLS:
        "https://relay.gdgs.jp/api/auth/callback/gdgjp, http://localhost:5181/api/auth/callback/gdgjp",
      ...overrides,
    } as unknown as Env;
  }

  it("returns a confidential PKCE client with offline_access and chapters scope", () => {
    const [spec] = collectSpecs(discordRelayEnv());
    expect(spec).toEqual({
      clientId: "discord-relay",
      clientSecret: "discord-relay-secret",
      clientName: "Discord Relay",
      redirectUris: [
        "https://relay.gdgs.jp/api/auth/callback/gdgjp",
        "http://localhost:5181/api/auth/callback/gdgjp",
      ],
      requirePKCE: true,
      public: false,
      scopes: ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE],
    });
  });

  it("omits the discord-relay spec when the secret is missing", () => {
    const specs = collectSpecs(discordRelayEnv({ DISCORD_RELAY_CLIENT_SECRET: "" }));
    expect(specs).toEqual([]);
  });
});

describe("trustedOAuthClientIds", () => {
  it("includes agents among the consent-skip trusted clients", () => {
    expect(trustedOAuthClientIds(agentsEnv())).toContain("agents");
  });

  it("includes pay among the consent-skip trusted clients", () => {
    expect(
      trustedOAuthClientIds({
        ...agentsEnv(),
        PAY_CLIENT_ID: "pay",
      } as unknown as Env),
    ).toContain("pay");
  });

  it("includes ost among the consent-skip trusted clients", () => {
    expect(
      trustedOAuthClientIds({
        ...agentsEnv(),
        OST_CLIENT_ID: "ost",
      } as unknown as Env),
    ).toContain("ost");
  });

  it("includes discord-relay among the consent-skip trusted clients", () => {
    expect(
      trustedOAuthClientIds({
        ...agentsEnv(),
        DISCORD_RELAY_CLIENT_ID: "discord-relay",
      } as unknown as Env),
    ).toContain("discord-relay");
  });
});
