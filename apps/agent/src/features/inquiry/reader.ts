import type { Reader } from "./wiki";

/** Where a question was asked, as far as who can read the reply. */
export type Venue =
  | { kind: "discord_guild"; guildId: string }
  | { kind: "discord_dm" }
  | { kind: "chat_space"; space: string }
  | { kind: "chat_dm" };

/**
 * Who the answer is generated AS. A reply in a guild channel or a Chat space is read by
 * everyone there, so it uses only the venue's principal even when the asker is a linked
 * organizer — otherwise organizer-only spans would be posted publicly. The asker's own
 * permissions are used only where only they read the reply: DMs and the ephemeral
 * "answer with my permissions" re-answer.
 */
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
