import { createDiscordAdapter } from "@chat-adapter/discord";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createIoRedisState } from "@chat-adapter/state-ioredis";
import { CHAPTERS_SCOPE } from "@gdgjp/gdg-lib/auth/claims";
import { Chat } from "chat";

/**
 * OAuth scopes the agents relying party requests at link time (Stage 5d).
 * Imported from `@gdgjp/gdg-lib/auth/claims` so the claim key cannot drift from the IdP.
 */
export const AGENTS_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  CHAPTERS_SCOPE,
] as const;

export type AgentsChat = Chat<{
  gchat: ReturnType<typeof createGoogleChatAdapter>;
  discord: ReturnType<typeof createDiscordAdapter>;
}>;

/**
 * Register Google Chat and Discord adapters with signature verification enabled.
 *
 * - Google Chat: `googleChatProjectNumber` from `GOOGLE_CHAT_AUDIENCE` (required aud).
 * - Discord: `publicKey` from `DISCORD_PUBLIC_KEY` (Ed25519).
 * - Never sets `disableSignatureVerification`.
 */
export function createAgentsChat(env: NodeJS.ProcessEnv = process.env): AgentsChat {
  const audience = env.GOOGLE_CHAT_AUDIENCE?.trim();
  if (!audience) {
    throw new Error("GOOGLE_CHAT_AUDIENCE is required for Google Chat webhook verification");
  }
  const discordPublicKey = env.DISCORD_PUBLIC_KEY?.trim();
  if (!discordPublicKey) {
    throw new Error("DISCORD_PUBLIC_KEY is required for Discord webhook verification");
  }
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for Chat SDK state and replay protection");
  }

  const gchat = createGoogleChatAdapter({
    googleChatProjectNumber: audience,
    // Credentials come from GOOGLE_CHAT_CREDENTIALS / GOOGLE_CHAT_USE_ADC.
  });

  const discord = createDiscordAdapter({
    publicKey: discordPublicKey,
    // botToken / applicationId come from DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID.
  });

  return new Chat({
    userName: "gdg-agent",
    adapters: {
      gchat,
      discord,
    },
    state: createIoRedisState({ url: redisUrl }),
    // Longer than the ±5 minute verify window so platform retries stay deduped.
    dedupeTtlMs: 10 * 60 * 1000,
    logger: "warn",
  });
}

let singleton: AgentsChat | null = null;

export function getAgentsChat(): AgentsChat {
  if (!singleton) {
    singleton = createAgentsChat();
  }
  return singleton;
}

/** Test-only: drop the lazy singleton. */
export function resetAgentsChatForTests(): void {
  singleton = null;
}
