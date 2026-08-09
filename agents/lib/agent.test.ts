import { readFileSync } from "node:fs";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { CHAPTERS_CLAIM } from "@gdgjp/gdg-lib/auth/claims";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentsChat } from "./adapters";
import {
  answerCitesPaths,
  defaultAgentModel,
  discordGuildId,
  handleInquiry,
  isUnlinkCommandText,
  registerAgentHandlers,
  resetAgentHandlersForTests,
  runWikiAgent,
} from "./agent";
import { ASK_COMMAND, LOGIN_COMMAND } from "./discord-commands";
import {
  type LinkAccountDeps,
  type LinkRedis,
  type StoredLinkRecord,
  createLinkAuthorizationUrl,
} from "./link-account";
import { encryptToken, parseTokenEncryptionKeys } from "./token-crypto";
import { WIKI_INDEX_PATH } from "./tools/wiki";

function keyB64(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return Buffer.from(bytes).toString("base64");
}

function createMemoryRedis(): LinkRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async setNX(key, value) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(key) {
      store.delete(key);
    },
    async getdel(key) {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    async compareAndSet(key, expected, value) {
      if (store.get(key) !== expected) return false;
      store.set(key, value);
      return true;
    },
    async compareAndDelete(key, expected) {
      if (store.get(key) !== expected) return false;
      store.delete(key);
      return true;
    },
  };
}

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
}

function toolCall(name: string, id: string, args: Record<string, unknown>) {
  return {
    type: "tool-call" as const,
    toolCallId: id,
    toolName: name,
    input: JSON.stringify(args),
  };
}

function textFinish(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: usage(),
    warnings: [],
  };
}

function toolFinish(calls: ReturnType<typeof toolCall>[]): LanguageModelV3GenerateResult {
  return {
    content: calls,
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: usage(),
    warnings: [],
  };
}

describe("defaultAgentModel", () => {
  it("uses the Vertex AI Gemini provider with its API key", () => {
    const model = defaultAgentModel({
      WIKI_API_URL: "https://wiki.gdgs.jp",
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      GOOGLE_VERTEX_API_KEY: "vertex-api-key",
    });

    expect(model.provider).toBe("google.vertex.chat");
    expect(model.modelId).toBe("gemini-2.5-flash");
  });

  it("requires a Vertex AI API key", () => {
    expect(() =>
      defaultAgentModel({
        WIKI_API_URL: "https://wiki.gdgs.jp",
        ACCOUNTS_URL: "https://accounts.gdgs.jp",
      }),
    ).toThrow("GOOGLE_VERTEX_API_KEY");
  });
});

describe("handleInquiry", () => {
  const keyring = parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1) }));
  const env = {
    IDP_CLIENT_ID: "agents",
    IDP_CLIENT_SECRET: "secret",
    ACCOUNTS_URL: "https://accounts.gdgs.jp",
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "1": keyB64(1) }),
  };

  let redis: ReturnType<typeof createMemoryRedis>;
  let wikiFetch: ReturnType<typeof vi.fn>;
  let now: number;

  beforeEach(() => {
    redis = createMemoryRedis();
    now = Math.floor(Date.now() / 1000);
    wikiFetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/auth/oauth2/userinfo")) {
        return Response.json({
          sub: "user-1",
          [CHAPTERS_CLAIM]: [{ chapterId: 1, chapterSlug: "osaka", role: "member" }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  });

  function linkDeps(overrides: Partial<LinkAccountDeps> = {}): LinkAccountDeps {
    return {
      env,
      redis,
      fetch: wikiFetch as unknown as typeof fetch,
      nowSeconds: () => now,
      keyring,
      ...overrides,
    };
  }

  it("does not call the Wiki API for an unlinked user", async () => {
    const outcome = await handleInquiry(
      {
        platform: "google-chat",
        chatUserId: "chat-user-1",
        prompt: "Suggest venues",
      },
      {
        link: linkDeps(),
        fetch: wikiFetch as unknown as typeof fetch,
        env: {
          WIKI_API_URL: "https://wiki.gdgs.jp",
          ACCOUNTS_URL: env.ACCOUNTS_URL,
        },
        model: new MockLanguageModelV3({
          doGenerate: async () => textFinish("should not run"),
        }),
      },
    );

    expect(outcome.kind).toBe("needs_link");
    if (outcome.kind === "needs_link") {
      expect(outcome.authorizationUrl).toContain("accounts.gdgs.jp");
      expect(outcome.text).toContain(outcome.authorizationUrl);
    }
    expect(wikiFetch.mock.calls.every((c) => !String(c[0]).includes("/api/agent/"))).toBe(true);
  });

  it("runs exploration ls/cat to a nested venue page rather than a single search", async () => {
    const access = "linked-token";
    const record: StoredLinkRecord = {
      platform: "google-chat",
      chatUserId: "chat-user-1",
      accessToken: await encryptToken(access, keyring),
      accessTokenExpiresAt: now + 3600,
      refreshToken: await encryptToken("refresh", keyring),
      subject: "user-1",
      linkedAt: now,
    };
    await redis.set("link:user:google-chat:chat-user-1", JSON.stringify(record), "EX", 60);

    const agentCalls: string[] = [];
    wikiFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/userinfo")) {
        return Response.json({
          sub: "user-1",
          [CHAPTERS_CLAIM]: [{ chapterId: 1, chapterSlug: "osaka", role: "member" }],
        });
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      expect(auth).toBe(`Bearer ${access}`);

      if (u.includes("/api/agent/cat") && u.includes("path=%2Fwiki%2Findex")) {
        agentCalls.push("cat:/wiki/index");
        return Response.json({ path: WIKI_INDEX_PATH, content: "# venues\n", nextCursor: null });
      }
      if (u.includes("/api/agent/ls") && u.includes("path=%2Fwiki%2Fvenues")) {
        agentCalls.push("ls:/wiki/venues");
        return Response.json({
          path: "/wiki/venues",
          entries: [
            {
              name: "umeda-hall",
              path: "/wiki/venues/umeda-hall",
              readable: true,
              hasChildren: false,
              title: "Umeda Hall",
            },
          ],
          nextCursor: null,
        });
      }
      if (u.includes("/api/agent/cat") && u.includes("path=%2Fwiki%2Fvenues%2Fumeda-hall")) {
        agentCalls.push("cat:/wiki/venues/umeda-hall");
        return Response.json({
          path: "/wiki/venues/umeda-hall",
          content: "Good for 80 people.",
          nextCursor: null,
        });
      }
      if (u.includes("/api/agent/search")) {
        agentCalls.push("search");
        return Response.json({ matches: [], nextCursor: null });
      }
      throw new Error(`unexpected: ${u}`);
    });

    const modelSteps = { n: 0 };
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        const n = modelSteps.n++;
        if (n === 0) {
          return toolFinish([toolCall("wiki_cat", "c1", { path: WIKI_INDEX_PATH })]);
        }
        if (n === 1) {
          return toolFinish([toolCall("wiki_ls", "c2", { path: "/wiki/venues" })]);
        }
        if (n === 2) {
          return toolFinish([toolCall("wiki_cat", "c3", { path: "/wiki/venues/umeda-hall" })]);
        }
        return textFinish(
          "Umeda Hall fits ~80 people. Source: https://wiki.gdgs.jp/wiki/umeda-hall",
        );
      },
    });

    const outcome = await handleInquiry(
      {
        platform: "google-chat",
        chatUserId: "chat-user-1",
        prompt: "Suggest venue candidates based on past results",
      },
      {
        link: linkDeps({ fetch: wikiFetch as unknown as typeof fetch }),
        fetch: wikiFetch as unknown as typeof fetch,
        env: { WIKI_API_URL: "https://wiki.gdgs.jp", ACCOUNTS_URL: env.ACCOUNTS_URL },
        model,
        chapters: [{ chapterId: "1", chapterSlug: "osaka", role: "member" }],
      },
    );

    expect(outcome.kind).toBe("answer");
    if (outcome.kind === "answer") {
      expect(answerCitesPaths(outcome.text, ["/wiki/venues/umeda-hall"])).toBe(true);
    }
    expect(agentCalls).toEqual([
      "cat:/wiki/index",
      "ls:/wiki/venues",
      "cat:/wiki/venues/umeda-hall",
    ]);
    expect(agentCalls).not.toContain("search");
  });

  it("surfaces Wiki 401 as a re-link prompt", async () => {
    const access = "expired-token";
    const record: StoredLinkRecord = {
      platform: "discord",
      chatUserId: "discord-1",
      accessToken: await encryptToken(access, keyring),
      accessTokenExpiresAt: now + 3600,
      refreshToken: await encryptToken("refresh", keyring),
      subject: "user-1",
      linkedAt: now,
    };
    await redis.set("link:user:discord:discord-1", JSON.stringify(record), "EX", 60);

    wikiFetch = vi.fn(async (url: string) => {
      if (String(url).includes("/api/agent/cat")) {
        return Response.json({ error: "invalid_token" }, { status: 401 });
      }
      throw new Error(`unexpected ${url}`);
    });

    const modelSteps = { n: 0 };
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        const n = modelSteps.n++;
        if (n === 0) {
          return toolFinish([toolCall("wiki_cat", "c1", { path: WIKI_INDEX_PATH })]);
        }
        return textFinish("ignored");
      },
    });

    const outcome = await handleInquiry(
      { platform: "discord", chatUserId: "discord-1", prompt: "hello" },
      {
        link: linkDeps({ fetch: wikiFetch as unknown as typeof fetch }),
        fetch: wikiFetch as unknown as typeof fetch,
        env: { WIKI_API_URL: "https://wiki.gdgs.jp", ACCOUNTS_URL: env.ACCOUNTS_URL },
        model,
        chapters: [{ chapterId: "1", chapterSlug: "osaka", role: "member" }],
      },
    );

    expect(outcome.kind).toBe("needs_relink");
    if (outcome.kind === "needs_relink") {
      expect(outcome.text).toContain(outcome.authorizationUrl);
    }
  });

  it("says the Wiki has no answer when exploration finds nothing", async () => {
    const access = "tok";
    const record: StoredLinkRecord = {
      platform: "google-chat",
      chatUserId: "u1",
      accessToken: await encryptToken(access, keyring),
      accessTokenExpiresAt: now + 3600,
      refreshToken: await encryptToken("refresh", keyring),
      subject: "user-1",
      linkedAt: now,
    };
    await redis.set("link:user:google-chat:u1", JSON.stringify(record), "EX", 60);

    wikiFetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("path=%2Fwiki%2Findex")) {
        return Response.json({ path: WIKI_INDEX_PATH, content: "# empty", nextCursor: null });
      }
      if (u.includes("/api/agent/search")) {
        return Response.json({ matches: [], nextCursor: null });
      }
      if (u.includes("/api/agent/ls")) {
        return Response.json({ path: "/wiki", entries: [], nextCursor: null });
      }
      throw new Error(u);
    });

    const noAnswer =
      "The Wiki does not have an answer for that. I can register a source if you share a URL.";

    const modelSteps = { n: 0 };
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        const n = modelSteps.n++;
        if (n === 0) {
          return toolFinish([toolCall("wiki_cat", "c1", { path: WIKI_INDEX_PATH })]);
        }
        if (n === 1) {
          return toolFinish([toolCall("wiki_search", "c2", { q: "unknown-venue-xyz" })]);
        }
        return textFinish(noAnswer);
      },
    });

    const outcome = await handleInquiry(
      { platform: "google-chat", chatUserId: "u1", prompt: "Where is unknown-venue-xyz?" },
      {
        link: linkDeps({ fetch: wikiFetch as unknown as typeof fetch }),
        fetch: wikiFetch as unknown as typeof fetch,
        env: { WIKI_API_URL: "https://wiki.gdgs.jp", ACCOUNTS_URL: env.ACCOUNTS_URL },
        model,
        chapters: [{ chapterId: "1", chapterSlug: "osaka", role: "member" }],
      },
    );

    expect(outcome.kind).toBe("answer");
    if (outcome.kind === "answer") {
      expect(outcome.text).toMatch(/Wiki does not have an answer/i);
      expect(outcome.text).not.toMatch(/I think the venue is/i);
    }
  });
});

describe("runWikiAgent tool order", () => {
  it("refuses wiki_search before index even when the model asks first", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ matches: [{ path: "/wiki/x", title: "X" }], nextCursor: null }),
    );
    const modelSteps = { n: 0 };
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        const n = modelSteps.n++;
        if (n === 0) {
          return toolFinish([toolCall("wiki_search", "s1", { q: "x" })]);
        }
        return textFinish("stopped");
      },
    });

    await runWikiAgent({
      accessToken: "t",
      chapters: [],
      prompt: "find x",
      model,
      fetch: fetchMock as unknown as typeof fetch,
      env: { WIKI_API_URL: "https://wiki.gdgs.jp", ACCOUNTS_URL: "https://accounts.gdgs.jp" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("detects /unlink command text for Google Chat", () => {
    expect(isUnlinkCommandText("/unlink")).toBe(true);
    expect(isUnlinkCommandText("/unlink please")).toBe(true);
    expect(isUnlinkCommandText("please /unlink")).toBe(false);
  });

  it("extracts guild_id from a Discord slash-command payload", () => {
    expect(discordGuildId({ guild_id: "guild-123", id: "interaction" })).toBe("guild-123");
  });

  it("returns undefined for a DM-shaped Discord payload without guild_id", () => {
    expect(discordGuildId({ id: "interaction" })).toBeUndefined();
    expect(discordGuildId({ guild_id: null })).toBeUndefined();
    expect(discordGuildId({ guild_id: "" })).toBeUndefined();
    expect(discordGuildId(null)).toBeUndefined();
  });

  it("answerCitesPaths accepts leaf slug URLs", () => {
    expect(
      answerCitesPaths("See https://wiki.gdgs.jp/wiki/umeda-hall", ["/wiki/venues/umeda-hall"]),
    ).toBe(true);
  });

  it("createLinkAuthorizationUrl is available for re-link flows", async () => {
    const redis = createMemoryRedis();
    const url = await createLinkAuthorizationUrl(
      { platform: "google-chat", chatUserId: "u" },
      {
        env: {
          IDP_CLIENT_ID: "agents",
          IDP_CLIENT_SECRET: "s",
          ACCOUNTS_URL: "https://accounts.gdgs.jp",
          TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "1": keyB64(1) }),
        },
        redis,
        keyring: parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1) })),
      },
    );
    expect(url).toContain("client_id=agents");
  });
});

describe("registerAgentHandlers", () => {
  beforeEach(() => {
    resetAgentHandlersForTests();
  });

  function fakeBot() {
    return {
      onNewMention: vi.fn(),
      onSubscribedMessage: vi.fn(),
      onDirectMessage: vi.fn(),
      onSlashCommand: vi.fn(),
    };
  }

  it("registers only slash commands for Discord (no mention/DM triggers)", () => {
    const bot = fakeBot();
    registerAgentHandlers(bot as unknown as AgentsChat, "discord");

    expect(bot.onNewMention).not.toHaveBeenCalled();
    expect(bot.onSubscribedMessage).not.toHaveBeenCalled();
    expect(bot.onDirectMessage).not.toHaveBeenCalled();
    expect(bot.onSlashCommand).toHaveBeenCalledWith(ASK_COMMAND, expect.any(Function));
    expect(bot.onSlashCommand).toHaveBeenCalledWith(LOGIN_COMMAND, expect.any(Function));
    expect(bot.onSlashCommand).toHaveBeenCalledTimes(2);
  });

  it("registers mention, subscribed, and DM handlers for Google Chat", () => {
    const bot = fakeBot();
    registerAgentHandlers(bot as unknown as AgentsChat, "gchat");

    expect(bot.onNewMention).toHaveBeenCalledTimes(1);
    expect(bot.onSubscribedMessage).toHaveBeenCalledTimes(1);
    expect(bot.onDirectMessage).toHaveBeenCalledTimes(1);
    expect(bot.onSlashCommand).toHaveBeenCalledWith(ASK_COMMAND, expect.any(Function));
    expect(bot.onSlashCommand).toHaveBeenCalledWith(LOGIN_COMMAND, expect.any(Function));
  });
});

describe("agent architecture", () => {
  it("does not mention embedding, vector, or VECTORIZE", () => {
    const source = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/embedding|vector|VECTORIZE/i);
  });
});
