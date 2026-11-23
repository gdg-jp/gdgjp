import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PubsubJwtEnv, resetPubsubJwksCache, verifyPubsubJwt } from "./pubsub-jwt.server";

const AUDIENCE = "https://meet.gdgs.jp/api/google/events";
const SERVICE_ACCOUNT = "pubsub-push-meet@example.iam.gserviceaccount.com";
const BASE_NOW_SEC = 1_800_000_000;

function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function generateRsaKeyPair(kid: string) {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
    alg?: string;
    use?: string;
  };
  return {
    privateKey: keyPair.privateKey,
    publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" },
  };
}

async function signJwt(
  privateKey: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, signingInput),
  );
  return `${headerB64}.${payloadB64}.${toBase64Url(signature)}`;
}

function createEnv(overrides: Partial<PubsubJwtEnv> = {}): PubsubJwtEnv {
  return {
    PUBSUB_PUSH_AUDIENCE: AUDIENCE,
    PUBSUB_PUSH_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    ...overrides,
  };
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    email: SERVICE_ACCOUNT,
    email_verified: true,
    iat: BASE_NOW_SEC - 30,
    exp: BASE_NOW_SEC + 300,
    ...overrides,
  };
}

beforeEach(() => {
  resetPubsubJwksCache();
});

afterEach(() => {
  resetPubsubJwksCache();
});

describe("verifyPubsubJwt", () => {
  it("正当な署名付き JWT を検証して claims を返す（JWKS キャッシュと kid ローテーション再取得を含む）", async () => {
    const key1 = await generateRsaKeyPair("kid-1");
    const key2 = await generateRsaKeyPair("kid-2");
    let rotated = false;

    const fetchMock = vi.fn(async () =>
      Response.json(
        { keys: rotated ? [key1.publicJwk, key2.publicJwk] : [key1.publicJwk] },
        { headers: { "Cache-Control": "public, max-age=600" } },
      ),
    ) as unknown as typeof fetch;

    const token1 = await signJwt(key1.privateKey, { alg: "RS256", kid: "kid-1" }, validClaims());
    const req1 = new Request(AUDIENCE, {
      method: "POST",
      headers: { Authorization: `Bearer ${token1}` },
    });

    const res1 = await verifyPubsubJwt(req1, createEnv(), {
      fetchFn: fetchMock,
      nowSec: () => BASE_NOW_SEC,
    });
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.claims.email).toBe(SERVICE_ACCOUNT);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2 回目は同一 kid のためキャッシュを使い JWKS を再取得しない。
    const res2 = await verifyPubsubJwt(req1, createEnv(), {
      fetchFn: fetchMock,
      nowSec: () => BASE_NOW_SEC + 10,
    });
    expect(res2.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 鍵ローテーション後（未知の kid-2）は 1 回だけ強制再取得して成功する。
    rotated = true;
    const token2 = await signJwt(
      key2.privateKey,
      { alg: "RS256", kid: "kid-2" },
      validClaims({ iss: "accounts.google.com" }),
    );
    const req2 = new Request(AUDIENCE, {
      method: "POST",
      headers: { Authorization: `Bearer ${token2}` },
    });
    const res3 = await verifyPubsubJwt(req2, createEnv(), {
      fetchFn: fetchMock,
      nowSec: () => BASE_NOW_SEC + 20,
    });
    expect(res3.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Authorization Bearer ヘッダ欠落・形式不正は 401 を返す", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const noHeader = new Request(AUDIENCE, { method: "POST" });
    const badScheme = new Request(AUDIENCE, {
      method: "POST",
      headers: { Authorization: "Basic abc" },
    });

    const res1 = await verifyPubsubJwt(noHeader, createEnv(), { fetchFn: fetchMock });
    const res2 = await verifyPubsubJwt(badScheme, createEnv(), { fetchFn: fetchMock });
    expect(res1).toMatchObject({ ok: false, status: 401 });
    expect(res2).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PUBSUB_PUSH_SERVICE_ACCOUNT が空のときは正当な JWT でも迂回せず 403 で拒否する", async () => {
    const key = await generateRsaKeyPair("kid-empty");
    const fetchMock = vi.fn(async () =>
      Response.json({ keys: [key.publicJwk] }),
    ) as unknown as typeof fetch;
    const token = await signJwt(key.privateKey, { alg: "RS256", kid: "kid-empty" }, validClaims());
    const req = new Request(AUDIENCE, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await verifyPubsubJwt(req, createEnv({ PUBSUB_PUSH_SERVICE_ACCOUNT: "" }), {
      fetchFn: fetchMock,
      nowSec: () => BASE_NOW_SEC,
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aud 不一致・email 不一致・email_verified: false・exp 期限切れ・署名改ざんをすべて 403 で拒否する", async () => {
    const key = await generateRsaKeyPair("kid-claims");
    const fetchMock = vi.fn(async () =>
      Response.json({ keys: [key.publicJwk] }),
    ) as unknown as typeof fetch;

    const badCases: Array<{ label: string; claims: Record<string, unknown>; tamper?: boolean }> = [
      { label: "aud 不一致", claims: validClaims({ aud: "https://other.example.com/events" }) },
      {
        label: "email 不一致",
        claims: validClaims({ email: "other@example.iam.gserviceaccount.com" }),
      },
      { label: "email_verified=false", claims: validClaims({ email_verified: false }) },
      { label: "exp 期限切れ", claims: validClaims({ exp: BASE_NOW_SEC - 61 }) },
      { label: "nbf 未来", claims: validClaims({ nbf: BASE_NOW_SEC + 61 }) },
      { label: "iss 不一致", claims: validClaims({ iss: "https://evil.example.com" }) },
      { label: "署名改ざん", claims: validClaims(), tamper: true },
    ];

    for (const c of badCases) {
      let token = await signJwt(key.privateKey, { alg: "RS256", kid: "kid-claims" }, c.claims);
      if (c.tamper) {
        const [h, p, s] = token.split(".");
        const flipped = s[0] === "A" ? `B${s.slice(1)}` : `A${s.slice(1)}`;
        token = `${h}.${p}.${flipped}`;
      }
      const req = new Request(AUDIENCE, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await verifyPubsubJwt(req, createEnv(), {
        fetchFn: fetchMock,
        nowSec: () => BASE_NOW_SEC,
      });
      expect(res, c.label).toMatchObject({ ok: false, status: 403 });
    }
  });
});
