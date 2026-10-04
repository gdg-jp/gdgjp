import type { ChatPlatform } from "../auth/contracts";

export function filingKey(platform: ChatPlatform, messageId: string): string {
  return `filing:${platform}:${messageId}`;
}
