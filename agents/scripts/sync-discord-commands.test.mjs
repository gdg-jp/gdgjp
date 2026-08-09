import { describe, expect, it, vi } from "vitest";

import { syncDiscordCommands } from "./sync-discord-commands.mjs";

const env = {
  DISCORD_APPLICATION_ID: "123456789012345678",
  DISCORD_BOT_TOKEN: "test-bot-token",
};

describe("syncDiscordCommands", () => {
  it("bulk synchronizes the /unlink global command", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const logger = { info: vi.fn() };

    await syncDiscordCommands({ env, fetchImpl, logger });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/123456789012345678/commands",
      {
        method: "PUT",
        headers: {
          Authorization: "Bot test-bot-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            name: "unlink",
            description: "Unlink this Discord account from GDG Accounts",
          },
        ]),
      },
    );
    expect(logger.info).toHaveBeenCalledWith("Synchronized 1 Discord global slash command(s).");
  });

  it("fails clearly when Discord credentials are missing", async () => {
    await expect(syncDiscordCommands({ env: {} })).rejects.toThrow(
      "DISCORD_APPLICATION_ID is required to synchronize Discord commands",
    );
    await expect(syncDiscordCommands({ env: { DISCORD_APPLICATION_ID: "id" } })).rejects.toThrow(
      "DISCORD_BOT_TOKEN is required to synchronize Discord commands",
    );
  });

  it("fails without exposing a Discord API error body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("secret Discord error detail", { status: 401 }));

    await expect(syncDiscordCommands({ env, fetchImpl })).rejects.toThrow(
      "Discord command synchronization failed (HTTP 401)",
    );
  });
});
