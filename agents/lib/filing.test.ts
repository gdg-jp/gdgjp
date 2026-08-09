import { afterEach, describe, expect, it, vi } from "vitest";

import { extractCitedPathsFromSteps, runFilingPass } from "./filing";
import type { LinkAccountDeps, StoredLinkRecord } from "./link-account";
import type { LinkRedis } from "./redis";
import { getVerifiedMessageId, runWithAgentRequestContext } from "./request-context";
import { encryptToken, parseTokenEncryptionKeys } from "./token-crypto";
import { clearFilingInstructionsCacheForTests } from "./wiki-write";

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

const longAnswer = "A".repeat(220);
const NOW = 1_700_000_000;
const KEYS_JSON = JSON.stringify({ "1": keyB64(7) });

async function seedLink(
  redis: LinkRedis,
  platform: "google-chat" | "discord",
  chatUserId: string,
): Promise<void> {
  const keys = parseTokenEncryptionKeys(KEYS_JSON);
  const record: StoredLinkRecord = {
    platform,
    chatUserId,
    accessToken: await encryptToken("access-token", keys),
    refreshToken: await encryptToken("refresh-token", keys),
    accessTokenExpiresAt: NOW + 3600,
    subject: "acc-1",
    linkedAt: NOW,
  };
  await redis.set(`link:user:${platform}:${chatUserId}`, JSON.stringify(record), "EX", 60);
}

function linkDeps(redis: LinkRedis, fetch: LinkAccountDeps["fetch"]): LinkAccountDeps {
  return {
    redis,
    fetch,
    nowSeconds: () => NOW,
    env: {
      ACCOUNTS_URL: "https://accounts.example",
      IDP_CLIENT_ID: "agents",
      IDP_CLIENT_SECRET: "secret",
      TOKEN_ENCRYPTION_KEYS: KEYS_JSON,
    },
  };
}

function answerSteps(toolResults: { toolName: string; output: unknown }[]) {
  return [
    {
      toolResults: toolResults.map((tr, i) => ({
        type: "tool-result" as const,
        toolCallId: `c${i}`,
        toolName: tr.toolName,
        input: {},
        output: tr.output,
      })),
    },
  ] as never;
}

afterEach(() => {
  clearFilingInstructionsCacheForTests();
});

describe("extractCitedPathsFromSteps", () => {
  it("takes paths from wiki_cat and wiki_search tool results only", () => {
    const paths = extractCitedPathsFromSteps(
      answerSteps([
        { toolName: "wiki_cat", output: { path: "/wiki/index", content: "idx" } },
        { toolName: "wiki_cat", output: { path: "/wiki/venues/a", content: "a" } },
        {
          toolName: "wiki_search",
          output: { matches: [{ path: "/wiki/venues/b", title: "B" }] },
        },
        { toolName: "wiki_ls", output: { path: "/wiki", entries: [] } },
      ]),
    );
    expect(paths).toEqual(["/wiki/venues/a", "/wiki/venues/b"]);
  });

  it("does not cite a path that only appears in answer text", () => {
    const paths = extractCitedPathsFromSteps(
      answerSteps([{ toolName: "wiki_cat", output: { path: "/wiki/venues/a", content: "a" } }]),
    );
    expect(paths).not.toContain("/wiki/invented");
  });
});

describe("runFilingPass gate", () => {
  it("skips generateObject for needs_link / needs_relink / temporarily_unavailable", async () => {
    const redis = createMemoryRedis();
    const generateObject = vi.fn();
    const fetch = vi.fn();

    for (const outcome of [
      { kind: "needs_link" as const, text: "link", authorizationUrl: "https://x" },
      { kind: "needs_relink" as const, text: "relink", authorizationUrl: "https://x" },
      { kind: "temporarily_unavailable" as const, text: "wait" },
    ]) {
      await runFilingPass(
        {
          platform: "google-chat",
          chatUserId: "u1",
          question: "q",
          outcome,
          messageId: `msg-${outcome.kind}`,
        },
        { redis, generateObject: generateObject as never, fetch },
      );
    }

    expect(generateObject).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call the model when fewer than two paths are cited", async () => {
    const redis = createMemoryRedis();
    await seedLink(redis, "discord", "u1");
    const generateObject = vi.fn();
    let logCalls = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/agent/log") && init?.method === "POST") {
        logCalls += 1;
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 500 });
    });

    await runFilingPass(
      {
        platform: "discord",
        chatUserId: "u1",
        question: "what is capacity?",
        messageId: "msg-short",
        outcome: {
          kind: "answer",
          text: longAnswer,
          steps: answerSteps([
            { toolName: "wiki_cat", output: { path: "/wiki/venues/a", content: "a" } },
          ]),
        },
      },
      {
        redis,
        generateObject: generateObject as never,
        fetch,
        link: linkDeps(redis, fetch),
      },
    );

    expect(generateObject).not.toHaveBeenCalled();
    expect(logCalls).toBe(1);
  });

  it("performs exactly one filing pass on webhook retry (Redis setNX)", async () => {
    const redis = createMemoryRedis();
    await seedLink(redis, "google-chat", "u1");
    let logCalls = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/agent/log") && init?.method === "POST") {
        logCalls += 1;
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: "instructions_unavailable" }), { status: 503 });
    });

    const input = {
      platform: "google-chat" as const,
      chatUserId: "u1",
      question: "Suggest venues",
      messageId: "same-message-id",
      outcome: {
        kind: "answer" as const,
        text: longAnswer,
        steps: answerSteps([
          { toolName: "wiki_cat", output: { path: "/wiki/venues/a", content: "a" } },
          { toolName: "wiki_cat", output: { path: "/wiki/venues/b", content: "b" } },
        ]),
      },
    };

    const deps = { redis, fetch, link: linkDeps(redis, fetch) };
    await runFilingPass(input, deps);
    await runFilingPass(input, deps);

    expect(logCalls).toBe(1);
  });

  it("propagates verified messageId through AsyncLocalStorage into after()-style work", async () => {
    let seen: string | undefined;
    await runWithAgentRequestContext({ messageId: "jti-from-verify" }, async () => {
      await Promise.resolve().then(() => {
        seen = getVerifiedMessageId();
      });
    });
    expect(seen).toBe("jti-from-verify");
    expect(getVerifiedMessageId()).toBeUndefined();
  });

  it("swallows note 409 and still writes the log entry", async () => {
    const redis = createMemoryRedis();
    await seedLink(redis, "discord", "u2");
    let logCalls = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/agent/instructions")) {
        return new Response(
          JSON.stringify({
            profile: "query",
            content: "## Sensitive information\n\nx\n\n### Citations\n\ny\n",
            contentHash: "abc",
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("/api/agent/notes")) {
        return new Response(JSON.stringify({ error: "citations_span_chapters" }), {
          status: 409,
        });
      }
      if (String(url).includes("/api/agent/log") && init?.method === "POST") {
        logCalls += 1;
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 500 });
    });

    const generateObject = vi.fn().mockResolvedValue({
      object: {
        file: true,
        reason: "synthesis",
        slug: "venue-picks",
        title: "Venue picks",
        summary: "Compare halls.",
        content: longAnswer,
      },
    });

    await expect(
      runFilingPass(
        {
          platform: "discord",
          chatUserId: "u2",
          question: "Suggest venues",
          messageId: "msg-409",
          outcome: {
            kind: "answer",
            text: longAnswer,
            steps: answerSteps([
              { toolName: "wiki_cat", output: { path: "/wiki/venues/a", content: "a" } },
              { toolName: "wiki_cat", output: { path: "/wiki/venues/b", content: "b" } },
            ]),
          },
        },
        {
          redis,
          fetch,
          generateObject: generateObject as never,
          link: linkDeps(redis, fetch),
        },
      ),
    ).resolves.toBeUndefined();
    expect(logCalls).toBe(1);
  });

  it("skips filing and logs Needs action when instructions are unavailable", async () => {
    const redis = createMemoryRedis();
    await seedLink(redis, "google-chat", "u3");
    const generateObject = vi.fn();
    let logBody: unknown;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/agent/instructions")) {
        return new Response(JSON.stringify({ error: "instructions_unavailable" }), {
          status: 503,
        });
      }
      if (String(url).includes("/api/agent/log") && init?.method === "POST") {
        logBody = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 500 });
    });

    await runFilingPass(
      {
        platform: "google-chat",
        chatUserId: "u3",
        question: "Suggest venues",
        messageId: "msg-503",
        outcome: {
          kind: "answer",
          text: longAnswer,
          steps: answerSteps([
            { toolName: "wiki_cat", output: { path: "/wiki/venues/a", content: "a" } },
            { toolName: "wiki_cat", output: { path: "/wiki/venues/b", content: "b" } },
          ]),
        },
      },
      {
        redis,
        fetch,
        generateObject: generateObject as never,
        link: linkDeps(redis, fetch),
      },
    );

    expect(generateObject).not.toHaveBeenCalled();
    expect(logBody).toMatchObject({
      lines: expect.arrayContaining([
        expect.stringContaining("Needs action: filing rules unavailable"),
      ]),
    });
  });
});
