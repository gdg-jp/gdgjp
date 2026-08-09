import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

import { GOOGLE_CHAT_ISSUER } from "../verify";

export const EXAMPLE_GOOGLE_CHAT_AUDIENCE = "428142970890";
export const OTHER_GOOGLE_CHAT_AUDIENCE = "111111111111";

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export type ChatFixtureKeys = {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
};

/** Locally generated RSA key for Google Chat JWT tests. */
export function createChatFixtureKeys(kid = "test-chat-kid"): ChatFixtureKeys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function signGoogleChatJwt(options: {
  privateKeyPem: string;
  kid: string;
  audience: string;
  jti: string;
  iat: number;
  exp: number;
  iss?: string;
  alg?: string;
}): string {
  const header = {
    alg: options.alg ?? "RS256",
    typ: "JWT",
    kid: options.kid,
  };
  const payload = {
    iss: options.iss ?? GOOGLE_CHAT_ISSUER,
    aud: options.audience,
    iat: options.iat,
    exp: options.exp,
    jti: options.jti,
  };
  const headerPart = base64Url(JSON.stringify(header));
  const payloadPart = base64Url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;

  if ((options.alg ?? "RS256").toLowerCase() === "none") {
    return `${signingInput}.`;
  }

  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    createPrivateKey(options.privateKeyPem),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

export type DiscordFixtureKeys = {
  publicKeyHex: string;
  privateKeyPem: string;
};

export function createDiscordFixtureKeys(): DiscordFixtureKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const rawPublic = publicKey.export({ type: "spki", format: "der" });
  // SPKI for Ed25519 is prefix (12 bytes) + 32-byte raw key.
  const publicKeyHex = Buffer.from(rawPublic).subarray(-32).toString("hex");
  return { publicKeyHex, privateKeyPem };
}

export function signDiscordRequest(
  privateKeyPem: string,
  timestamp: string,
  rawBody: string,
): string {
  const signature = sign(
    null,
    Buffer.from(`${timestamp}${rawBody}`),
    createPrivateKey(privateKeyPem),
  );
  return signature.toString("hex");
}

export function discordPingBody(id: string): string {
  return JSON.stringify({ id, type: 1 });
}
