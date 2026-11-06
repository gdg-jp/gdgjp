import { describe, expect, it } from "vitest";
import { memoryReplayStore, verifyWebhook } from "./verify";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function discordKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (timestamp: string, body: string) =>
    hex(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        pair.privateKey,
        new TextEncoder().encode(timestamp + body),
      ),
    );
  return { publicKey, sign };
}

function request(signature: string, timestamp: string) {
  return new Request("https://agent.gdgs.jp/api/chat", {
    method: "POST",
    headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
  });
}

describe("verifyWebhook (Discord)", () => {
  it("accepts a signed interaction once and rejects the replay", async () => {
    const { publicKey, sign } = await discordKeys();
    const replay = memoryReplayStore();
    const now = 1_800_000_000;
    const body = JSON.stringify({ id: "i1", type: 2 });
    const ts = String(now);
    const deps = { discordPublicKey: publicKey, replay, now: () => now };
    expect(await verifyWebhook(request(await sign(ts, body), ts), body, deps)).toMatchObject({
      ok: true,
      ping: false,
    });
    expect(await verifyWebhook(request(await sign(ts, body), ts), body, deps)).toEqual({
      ok: false,
      reason: "replay",
    });
  });

  it("rejects a bad signature, a tampered body and an old timestamp before any state", async () => {
    const { publicKey, sign } = await discordKeys();
    const replay = memoryReplayStore();
    const now = 1_800_000_000;
    const ts = String(now);
    const body = JSON.stringify({ id: "i2", type: 2 });
    const deps = { discordPublicKey: publicKey, replay, now: () => now };
    const signature = await sign(ts, body);
    expect(await verifyWebhook(request(signature, ts), body.replace("i2", "i3"), deps)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await verifyWebhook(request("00".repeat(64), ts), body, deps)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    const old = String(now - 600);
    expect(await verifyWebhook(request(await sign(old, body), old), body, deps)).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    });
    expect(replay.keys.size).toBe(0);
  });

  it("answers a signed PING without touching replay storage", async () => {
    const { publicKey, sign } = await discordKeys();
    const replay = memoryReplayStore();
    const now = 1_800_000_000;
    const ts = String(now);
    const body = JSON.stringify({ type: 1 });
    expect(
      await verifyWebhook(request(await sign(ts, body), ts), body, {
        discordPublicKey: publicKey,
        replay,
        now: () => now,
      }),
    ).toMatchObject({
      ok: true,
      ping: true,
    });
    expect(replay.keys.size).toBe(0);
  });
});

describe("verifyWebhook (Google Chat)", () => {
  it("rejects unsigned and alg=none tokens", async () => {
    const replay = memoryReplayStore();
    const deps = { discordPublicKey: "", googleChatAudience: "123", replay };
    const none = `${btoa(JSON.stringify({ alg: "none" }))}.${btoa("{}")}.`;
    const req = (token: string) =>
      new Request("https://agent.gdgs.jp/api/chat", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
    expect(await verifyWebhook(req(none), "{}", deps)).toMatchObject({ ok: false });
    expect(
      await verifyWebhook(
        new Request("https://agent.gdgs.jp/api/chat", { method: "POST" }),
        "{}",
        deps,
      ),
    ).toEqual({
      ok: false,
      reason: "missing_authorization",
    });
  });
});
