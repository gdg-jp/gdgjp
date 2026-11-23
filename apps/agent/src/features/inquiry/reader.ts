import type { Reader } from "./wiki";

export type Venue =
  | { kind: "discord_guild"; guildId: string }
  | { kind: "discord_dm" }
  | { kind: "chat_space"; space: string }
  | { kind: "chat_dm" };

export function chooseReader(
  venue: Venue,
  linkedToken: string | null,
  privateReply: boolean,
): Reader {
  if ((privateReply || venue.kind === "discord_dm" || venue.kind === "chat_dm") && linkedToken) {
    return { kind: "user", token: linkedToken };
  }
  if (venue.kind === "discord_guild")
    return { kind: "principal", type: "discord_guild", id: venue.guildId };
  if (venue.kind === "chat_space")
    return { kind: "principal", type: "chat_space", id: venue.space };
  return { kind: "anonymous" };
}
