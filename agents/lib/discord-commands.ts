import commands from "../discord-commands.json";

export type DiscordApplicationCommand = {
  name: string;
  description: string;
  options?: readonly {
    name: string;
    description: string;
    type: number;
    required?: boolean;
  }[];
};

/**
 * The complete desired set of Discord global application commands.
 *
 * This is shared with the deployment synchronizer, whose bulk PUT makes the
 * Discord API match this list exactly.
 */
export const DISCORD_COMMANDS = commands as readonly DiscordApplicationCommand[];

export const ASK_COMMAND = "/ask";
export const UNLINK_COMMAND = "/unlink";
