/**
 * Discord user OAuth for the /sources guild picker (`identify` + `guilds`).
 * Channel history uses DISCORD_BOT_TOKEN, not these user tokens.
 */

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_OAUTH_SCOPES = "identify guilds";
export const REQUIRED_DISCORD_OAUTH_SCOPES = ["identify", "guilds"] as const;

/** View Channel | Read Message History — bot invite permissions for source import. */
export const DISCORD_BOT_SOURCE_PERMISSIONS = String((1n << 10n) | (1n << 16n));

export const DISCORD_REAUTH_MESSAGE =
  "Discord access is missing required scopes. Disconnect and reconnect Discord from /sources.";

export const DISCORD_BOT_ACCESS_MESSAGE =
  "The Discord bot cannot read this channel. Invite the bot with View Channel and Read Message History, and enable Message Content Intent.";

export interface DiscordOauthToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  grantedScopes: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

const TOKEN_TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

export function hasRequiredDiscordOauthScopes(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  const granted = new Set(grantedScopes.split(/\s+/).filter(Boolean));
  return REQUIRED_DISCORD_OAUTH_SCOPES.every((scope) => granted.has(scope));
}

export function getDiscordAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DISCORD_OAUTH_SCOPES,
    prompt: "consent",
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

/**
 * Bot invite URL. When `guildId` is set the Discord UI pre-selects that server;
 * omit it for a general invite the admin can point at any server.
 */
export function getDiscordBotInviteUrl(clientId: string, guildId?: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: DISCORD_BOT_SOURCE_PERMISSIONS,
    scope: "bot",
  });
  if (guildId) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

export async function exchangeDiscordCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<DiscordOauthToken> {
  const response = await fetchWithTimeout(
    `${DISCORD_API}/oauth2/token`,
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
    throw new Error(`Discord token exchange failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    grantedScopes: data.scope?.trim() || null,
  };
}

export async function refreshDiscordAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<DiscordOauthToken> {
  const response = await fetchWithTimeout(
    `${DISCORD_API}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
    TOKEN_TIMEOUT_MS,
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Discord token refresh failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    grantedScopes: data.scope?.trim() || null,
  };
}

export async function fetchDiscordCurrentUser(accessToken: string): Promise<{ id: string }> {
  const response = await fetchWithTimeout(
    `${DISCORD_API}/users/@me`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    TOKEN_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Discord users/@me failed: ${response.status}`);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("Discord users/@me response missing id");
  return { id: data.id };
}
