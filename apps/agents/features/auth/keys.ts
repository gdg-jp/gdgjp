import type { ChatPlatform } from "../chat/platform";

export function linkStateKey(state: string): string {
  return `link:state:${state}`;
}

export function linkUserKey(platform: ChatPlatform, chatUserId: string): string {
  return `link:user:${platform}:${chatUserId}`;
}

export function linkGuildKey(platform: ChatPlatform, guildId: string): string {
  return `link:guild:${platform}:${guildId}`;
}
