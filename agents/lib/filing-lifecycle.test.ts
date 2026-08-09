import { beforeEach, describe, expect, it, vi } from "vitest";

const runFilingPassMock = vi.fn<(...args: unknown[]) => Promise<void>>();

vi.mock("./filing", () => ({
  runFilingPass: (...args: unknown[]) => runFilingPassMock(...args),
}));

import type { AgentsChat } from "./adapters";
import { registerAgentHandlers, resetAgentHandlersForTests } from "./agent";
import { ASK_COMMAND } from "./discord-commands";
import type { LinkAccountDeps, LinkRedis } from "./link-account";
import { parseTokenEncryptionKeys } from "./token-crypto";

function keyB64(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return Buffer.from(bytes).toString("base64");
}

/** Empty store: every lookup misses, so handleInquiry short-circuits to needs_link. */
function emptyRedis(): LinkRedis {
  const store = new Map<string, string>();
  return {
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
    async compareAndSet() {
      return true;
    },
    async compareAndDelete() {
      return true;
    },
  };
}

function linkDeps(): LinkAccountDeps {
  return {
    env: {
      IDP_CLIENT_ID: "agents",
      IDP_CLIENT_SECRET: "secret",
      ACCOUNTS_URL: "https://accounts.gdgs.jp",
      TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "1": keyB64(1) }),
    },
    redis: emptyRedis(),
    fetch: (async () => {
      throw new Error("no network expected for an unlinked user");
    }) as unknown as typeof fetch,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    keyring: parseTokenEncryptionKeys(JSON.stringify({ "1": keyB64(1) })),
  };
}

function fakeBot() {
  return {
    onNewMention: vi.fn(),
    onSubscribedMessage: vi.fn(),
    onDirectMessage: vi.fn(),
    onSlashCommand: vi.fn(),
  };
}

beforeEach(() => {
  resetAgentHandlersForTests();
  runFilingPassMock.mockReset().mockResolvedValue(undefined);
});

describe("filing runs inside the handler promise, not detached", () => {
  it("does not resolve the /ask handler until filing completes", async () => {
    // A detached `void runFilingPass(...)` would let the handler — and therefore
    // the Chat SDK task that after() tracks — settle first, so the invocation can
    // end and cancel filing. The handler must keep it in its own promise chain.
    const order: string[] = [];
    let releaseFiling: (() => void) | undefined;
    let filingStarted = false;
    runFilingPassMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          filingStarted = true;
          order.push("filing");
          releaseFiling = resolve;
        }),
    );

    const bot = fakeBot();
    registerAgentHandlers(bot as unknown as AgentsChat, "discord", { link: linkDeps() });

    const askHandler = bot.onSlashCommand.mock.calls.find(
      (call) => call[0] === ASK_COMMAND,
    )?.[1] as (event: unknown) => Promise<void>;
    expect(askHandler).toBeTypeOf("function");

    const posted: string[] = [];
    const handlerPromise = askHandler({
      adapter: { name: "discord" },
      channel: {
        post: async (text: string) => {
          order.push("post");
          posted.push(text);
        },
      },
      user: { userId: "u1" },
      text: "Suggest venues",
      raw: { guild_id: "g1" },
    });

    let settled = false;
    void handlerPromise.then(() => {
      settled = true;
    });

    // Let the reply post and filing start, but keep filing pending.
    for (let i = 0; i < 100 && !filingStarted; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(posted).toHaveLength(1);
    expect(filingStarted).toBe(true);
    expect(settled).toBe(false);

    releaseFiling?.();
    await handlerPromise;
    expect(settled).toBe(true);

    // Filing must also start only after the reply is out, so a slow or failing
    // filing pass can never delay the answer.
    expect(order).toEqual(["post", "filing"]);
  });
});
