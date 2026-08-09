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

/** A per-platform Chat SDK instance. */
type DiscordChat = Chat<{ discord: ReturnType<typeof createDiscordAdapter> }>;
type GoogleChat = Chat<{ gchat: ReturnType<typeof createGoogleChatAdapter> }>;
export type AgentsChat = DiscordChat | GoogleChat;
export type ChatPlatformAdapter = "discord" | "gchat";

/**
 * Register one chat adapter with signature verification enabled.
 *
 * - Google Chat: `googleChatProjectNumber` from `GOOGLE_CHAT_AUDIENCE` (required aud).
 * - Discord: `publicKey` from `DISCORD_PUBLIC_KEY` (Ed25519).
 * - Never sets `disableSignatureVerification`.
 */
export function createAgentsChat(platform: "discord", env?: NodeJS.ProcessEnv): DiscordChat;
export function createAgentsChat(platform: "gchat", env?: NodeJS.ProcessEnv): GoogleChat;
export function createAgentsChat(
  platform: ChatPlatformAdapter,
  env: NodeJS.ProcessEnv = process.env,
): AgentsChat {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for Chat SDK state and replay protection");
  }

  const common = {
    userName: "gdg-agent",
    state: createIoRedisState({ url: redisUrl }),
    // Longer than the ±5 minute verify window so platform retries stay deduped.
    dedupeTtlMs: 10 * 60 * 1000,
    logger: "warn" as const,
  };

  if (platform === "discord") {
    const publicKey = env.DISCORD_PUBLIC_KEY?.trim();
    if (!publicKey) {
      throw new Error("DISCORD_PUBLIC_KEY is required for Discord webhook verification");
    }
    const botToken = env.DISCORD_BOT_TOKEN?.trim();
    if (!botToken) {
      throw new Error("DISCORD_BOT_TOKEN is required for Discord responses");
    }
    const applicationId = env.DISCORD_APPLICATION_ID?.trim();
    if (!applicationId) {
      throw new Error("DISCORD_APPLICATION_ID is required for Discord responses");
    }
    return new Chat({
      ...common,
      adapters: {
        discord: createDiscordAdapter({
          publicKey,
          botToken,
          applicationId,
        }),
      },
    });
  }

  const audience = env.GOOGLE_CHAT_AUDIENCE?.trim();
  if (!audience) {
    throw new Error("GOOGLE_CHAT_AUDIENCE is required for Google Chat webhook verification");
  }
  return new Chat({
    ...common,
    adapters: {
      gchat: createGoogleChatAdapter({
        googleChatProjectNumber: audience,
        // Credentials come from GOOGLE_CHAT_CREDENTIALS / GOOGLE_CHAT_USE_ADC.
      }),
    },
  });
}

let discordSingleton: DiscordChat | null = null;
let googleChatSingleton: GoogleChat | null = null;

export function getAgentsChat(platform: "discord"): DiscordChat;
export function getAgentsChat(platform: "gchat"): GoogleChat;
export function getAgentsChat(platform: ChatPlatformAdapter): AgentsChat {
  if (platform === "discord") {
    discordSingleton ??= createAgentsChat("discord");
    return discordSingleton;
  }
  googleChatSingleton ??= createAgentsChat("gchat");
  return googleChatSingleton;
}

/** Test-only: drop the lazy singleton. */
export function resetAgentsChatForTests(): void {
  discordSingleton = null;
  googleChatSingleton = null;
}
