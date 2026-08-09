import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXAMPLE_GOOGLE_CHAT_AUDIENCE,
  OTHER_GOOGLE_CHAT_AUDIENCE,
  createChatFixtureKeys,
  createDiscordFixtureKeys,
  discordPingBody,
  signDiscordRequest,
  signGoogleChatJwt,
} from "./fixtures/webhook-fixtures";
import {
  GOOGLE_CHAT_CERTS_URL,
  clearGoogleChatCertCacheForTests,
  createMemoryReplayStore,
  verifyWebhook,
} from "./verify";

describe("verifyWebhook", () => {
  const chatKeys = createChatFixtureKeys();
  const otherChatKeys = createChatFixtureKeys("other-kid");
  const discordKeys = createDiscordFixtureKeys();
  const now = Math.floor(Date.now() / 1000);

  let replay: ReturnType<typeof createMemoryReplayStore>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let downstreamCalls: number;

  beforeEach(() => {
    clearGoogleChatCertCacheForTests();
    replay = createMemoryReplayStore();
    downstreamCalls = 0;
    fetchMock = vi.fn(async (input: string) => {
      if (input === GOOGLE_CHAT_CERTS_URL) {
        return Response.json({ [chatKeys.kid]: chatKeys.publicKeyPem });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
  });

  function chatDeps(audience = EXAMPLE_GOOGLE_CHAT_AUDIENCE) {
    return {
      env: {
        GOOGLE_CHAT_AUDIENCE: audience,
        DISCORD_PUBLIC_KEY: discordKeys.publicKeyHex,
      },
      replay,
      fetch: fetchMock as typeof fetch,
      nowSeconds: () => now,
    };
  }

  function discordDeps() {
    return chatDeps();
  }

  function chatRequest(token: string | null, body = "{}") {
    const headers = new Headers({ "content-type": "application/json" });
    if (token !== null) headers.set("authorization", `Bearer ${token}`);
    return new Request("https://agent.gdgs.jp/api/chat", {
      method: "POST",
      headers,
      body,
    });
  }

  function validChatToken(
    overrides: Partial<{
      privateKeyPem: string;
      kid: string;
      audience: string;
      jti: string;
      iat: number;
      exp: number;
      iss: string;
      alg: string;
    }> = {},
  ) {
    return signGoogleChatJwt({
      privateKeyPem: overrides.privateKeyPem ?? chatKeys.privateKeyPem,
      kid: overrides.kid ?? chatKeys.kid,
      audience: overrides.audience ?? EXAMPLE_GOOGLE_CHAT_AUDIENCE,
      jti: overrides.jti ?? `jti-${Math.random().toString(16).slice(2)}`,
      iat: overrides.iat ?? now,
      exp: overrides.exp ?? now + 3600,
      iss: overrides.iss,
      alg: overrides.alg,
    });
  }

  async function assertRejectedNoSideEffects(request: Request, rawBody: string, deps = chatDeps()) {
    const fetchCallsBefore = fetchMock.mock.calls.length;
    const readsBefore = replay.reads;
    const result = await verifyWebhook(request, rawBody, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
    expect(fetchMock.mock.calls.length).toBe(fetchCallsBefore);
    expect(replay.reads).toBe(readsBefore);
    expect(downstreamCalls).toBe(0);
    return result;
  }

  it("rejects a missing Authorization header with 401 and no fetch/redis", async () => {
    const request = chatRequest(null);
    await assertRejectedNoSideEffects(request, "{}");
  });

  it("rejects an unsigned token with 401 and no fetch/redis", async () => {
    const request = chatRequest("not-a-jwt");
    await assertRejectedNoSideEffects(request, "{}");
  });

  it("rejects alg:none with 401 and no fetch/redis", async () => {
    const token = validChatToken({ alg: "none" });
    const request = chatRequest(token);
    const result = await assertRejectedNoSideEffects(request, "{}");
    if (!result.ok) expect(result.reason).toBe("alg_none");
  });

  it("rejects a JWT signed by a key not in the certificate set", async () => {
    const token = signGoogleChatJwt({
      privateKeyPem: otherChatKeys.privateKeyPem,
      kid: otherChatKeys.kid,
      audience: EXAMPLE_GOOGLE_CHAT_AUDIENCE,
      jti: "jti-unknown-key",
      iat: now,
      exp: now + 3600,
    });
    const request = chatRequest(token);
    const readsBefore = replay.reads;
    const result = await verifyWebhook(request, "{}", chatDeps());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("bad_signature");
    }
    expect(fetchMock).toHaveBeenCalled();
    expect(replay.reads).toBe(readsBefore);
    expect(downstreamCalls).toBe(0);
  });

  it("rejects a correctly signed Chat JWT with a different audience (impersonation)", async () => {
    const token = validChatToken({ audience: OTHER_GOOGLE_CHAT_AUDIENCE });
    const request = chatRequest(token);
    const readsBefore = replay.reads;
    const result = await verifyWebhook(request, "{}", chatDeps());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("bad_audience");
    }
    expect(fetchMock).toHaveBeenCalled();
    expect(replay.reads).toBe(readsBefore);
    expect(downstreamCalls).toBe(0);
  });

  it("rejects a Chat JWT with the wrong issuer", async () => {
    const token = validChatToken({ iss: "evil@example.com" });
    const request = chatRequest(token);
    const result = await assertRejectedNoSideEffects(request, "{}");
    if (!result.ok) expect(result.reason).toBe("bad_issuer");
  });

  it("rejects a Discord payload altered after signing", async () => {
    const body = discordPingBody("interaction-1");
    const timestamp = String(now);
    const signature = signDiscordRequest(discordKeys.privateKeyPem, timestamp, body);
    const request = new Request("https://agent.gdgs.jp/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: '{"id":"interaction-1","type":1,"tampered":true}',
    });
    await assertRejectedNoSideEffects(
      request,
      '{"id":"interaction-1","type":1,"tampered":true}',
      discordDeps(),
    );
  });

  it("accepts Discord's id-less endpoint-validation PING without Redis", async () => {
    const body = discordPingBody();
    const timestamp = String(now);
    const signature = signDiscordRequest(discordKeys.privateKeyPem, timestamp, body);
    const request = new Request("https://agent.gdgs.jp/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });
    const result = await verifyWebhook(request, body, discordDeps());
    expect(result).toEqual({
      ok: true,
      platform: "discord",
      discordPing: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replay.reads).toBe(0);
    expect(replay.remembers).toBe(0);
  });

  it("rejects an invalid Discord signature with 401 (never 200)", async () => {
    const body = discordPingBody("interaction-bad");
    const request = new Request("https://agent.gdgs.jp/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "00".repeat(64),
        "x-signature-timestamp": String(now),
      },
      body,
    });
    const result = await assertRejectedNoSideEffects(request, body, discordDeps());
    if (!result.ok) expect(result.status).not.toBe(200);
  });

  it("rejects a request whose timestamp is 10 minutes old", async () => {
    const token = validChatToken({ iat: now - 10 * 60, exp: now + 3600 });
    const request = chatRequest(token);
    const readsBefore = replay.reads;
    const result = await verifyWebhook(request, "{}", chatDeps());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toBe("timestamp_out_of_window");
    }
    expect(replay.reads).toBe(readsBefore);
  });

  it("drops a replayed request and does not invoke downstream twice", async () => {
    const jti = "jti-replay-once";
    const token = validChatToken({ jti });
    const request = chatRequest(token);
    const first = await verifyWebhook(request, "{}", chatDeps());
    expect(first.ok).toBe(true);
    downstreamCalls += 1;

    const second = await verifyWebhook(request, "{}", chatDeps());
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("replay");
    expect(downstreamCalls).toBe(1);
  });

  it("accepts a correctly signed Chat JWT for the configured audience", async () => {
    const token = validChatToken({ jti: "jti-ok" });
    const result = await verifyWebhook(chatRequest(token), "{}", chatDeps());
    expect(result).toEqual({
      ok: true,
      platform: "google-chat",
      messageId: "jti-ok",
    });
  });
});
