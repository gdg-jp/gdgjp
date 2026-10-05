import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface FcmMessage {
  title: string;
  body?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// JWT / OAuth helpers (Web Crypto — works in Cloudflare Workers)
// ---------------------------------------------------------------------------

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function textToBase64url(text: string): string {
  return base64url(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(pemBody);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    buffer.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function createSignedJwt(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = textToBase64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = textToBase64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput).buffer as ArrayBuffer,
  );
  return `${signingInput}.${base64url(sig)}`;
}

// Module-scoped token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  const sa: ServiceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  const jwt = await createSignedJwt(sa);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ---------------------------------------------------------------------------
// Send push to a single device
// ---------------------------------------------------------------------------

async function sendToToken(
  env: Env,
  accessToken: string,
  deviceToken: string,
  message: FcmMessage,
): Promise<"ok" | "stale"> {
  const projectId = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON).project_id as string;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        webpush: {
          fcm_options: { link: message.url },
        },
      },
    }),
  });
  if (res.ok) return "ok";
  const status = res.status;
  // 404 = token not found, 410 = token expired — both mean stale
  if (status === 404 || status === 410) return "stale";
  const body = await res.text();
  console.error(`[fcm] sendToToken failed (${status}): ${body}`);
  return "ok"; // treat other errors as transient — don't delete token
}

// ---------------------------------------------------------------------------
// Send push to all devices of a user
// ---------------------------------------------------------------------------

export async function sendPushToUser(
  env: Env,
  userId: string,
  messageJa: FcmMessage,
  messageEn: FcmMessage,
): Promise<void> {
  if (env.ENVIRONMENT !== "production") {
    console.log("[fcm] DEV MODE — would send push notification:");
    console.log(`  User: ${userId}`);
    console.log(`  Title (JA): ${messageJa.title}`);
    console.log(`  Title (EN): ${messageEn.title}`);
    return;
  }

  if (!env.FCM_SERVICE_ACCOUNT_JSON) {
    console.log("[fcm] FCM_SERVICE_ACCOUNT_JSON not set — skipping push");
    return;
  }

  const db = drizzle(env.DB, { schema });

  // Get user's language preference
  const prefRow = await db
    .select({ lang: schema.userPreferences.preferredUiLanguage })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .get();
  const lang = prefRow?.lang ?? "ja";
  const message = lang === "en" ? messageEn : messageJa;

  // Get all device tokens
  const tokens = await db
    .select({ token: schema.fcmTokens.token })
    .from(schema.fcmTokens)
    .where(eq(schema.fcmTokens.userId, userId))
    .all();

  if (tokens.length === 0) return;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(env);
  } catch (err) {
    console.error("[fcm] Failed to get access token:", err);
    return;
  }

  const staleTokens: string[] = [];
  await Promise.all(
    tokens.map(async ({ token }) => {
      const result = await sendToToken(env, accessToken, token, message);
      if (result === "stale") staleTokens.push(token);
    }),
  );

  // Clean up stale tokens
  for (const token of staleTokens) {
    await db.delete(schema.fcmTokens).where(eq(schema.fcmTokens.token, token));
  }
}
