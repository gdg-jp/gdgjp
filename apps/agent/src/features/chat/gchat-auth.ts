import { buffer, base64Decode, base64UrlEncode, nowSeconds } from "../../lib";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
let cached: { token: string; expiresAt: number } | null = null;

/** OAuth token for the Chat app (scope chat.bot) from the service account, signed with WebCrypto. */
export async function chatAccessToken(
  credentials: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (cached && cached.expiresAt > nowSeconds() + 60) return cached.token;
  if (!credentials) throw new Error("GOOGLE_CHAT_CREDENTIALS is not configured");
  const account = JSON.parse(credentials) as ServiceAccount;
  const now = nowSeconds();
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const encode = (value: unknown) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/chat.bot",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    buffer(base64Decode(pem)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64UrlEncode(signature)}`,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !body.access_token) throw new Error(`chat_token_failed:${response.status}`);
  cached = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return body.access_token;
}

export function clearChatTokenCacheForTests(): void {
  cached = null;
}
