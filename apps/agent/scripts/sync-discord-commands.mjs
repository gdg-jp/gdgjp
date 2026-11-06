import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import commands from "../discord-commands.json" with { type: "json" };

const DISCORD_API_URL = "https://discord.com/api/v10";

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required to synchronize Discord commands`);
  return value;
}

/** Synchronize the complete desired command set without exposing credentials or response bodies. */
export async function syncDiscordCommands({
  env = process.env,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const applicationId = requiredEnv(env, "DISCORD_APPLICATION_ID");
  const botToken = requiredEnv(env, "DISCORD_BOT_TOKEN");
  const response = await fetchImpl(`${DISCORD_API_URL}/applications/${applicationId}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Discord command synchronization failed (HTTP ${response.status})`);
  }

  logger.info(`Synchronized ${commands.length} Discord global slash command(s).`);
}

async function main() {
  await syncDiscordCommands();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Discord command synchronization failed",
    );
    process.exitCode = 1;
  });
}
