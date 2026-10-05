/**
 * Google Drive / Chat OAuth: scopes, the consent URL, and code/refresh token
 * exchange. Drive file export and the Docs document reader live in
 * `drive.server.ts`.
 */
import { fetchWithTimeout } from "./drive-fetch.server";

export interface DriveToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  /** Space-delimited scopes returned by the token endpoint, when present. */
  grantedScopes: string | null;
}

export const GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_CHAT_SPACES_SCOPE = "https://www.googleapis.com/auth/chat.spaces.readonly";
export const GOOGLE_CHAT_MESSAGES_SCOPE = "https://www.googleapis.com/auth/chat.messages.readonly";

export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  "https://www.googleapis.com/auth/forms.responses.readonly",
  GOOGLE_CHAT_SPACES_SCOPE,
  GOOGLE_CHAT_MESSAGES_SCOPE,
].join(" ");

export const REQUIRED_GOOGLE_CHAT_SCOPES = [
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_CHAT_SPACES_SCOPE,
  GOOGLE_CHAT_MESSAGES_SCOPE,
] as const;

export const GOOGLE_DRIVE_REAUTH_MESSAGE =
  "Google Drive access is missing required scopes. Disconnect and reconnect Google from /sources to grant the required access.";

/** True when every required Chat scope appears in a space-delimited grant string. */
export function hasRequiredGoogleChatScopes(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  const granted = new Set(grantedScopes.split(/\s+/).filter(Boolean));
  return REQUIRED_GOOGLE_CHAT_SCOPES.every((scope) => granted.has(scope));
}

// ---------------------------------------------------------------------------
// OAuth URL generation
// ---------------------------------------------------------------------------

export function getGoogleDriveAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

const TOKEN_TIMEOUT_MS = 10_000;

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<DriveToken> {
  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
    TOKEN_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    grantedScopes: data.scope?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: Date; grantedScopes: string | null }> {
  const response = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    },
    TOKEN_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    grantedScopes: data.scope?.trim() || null,
  };
}
