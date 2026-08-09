import { describe, expect, it } from "vitest";

import { createAgentsChat } from "./adapters";

describe("createAgentsChat", () => {
  it("initializes Discord without Google Chat credentials", () => {
    expect(() =>
      createAgentsChat("discord", {
        ...process.env,
        REDIS_URL: "redis://redis.example.test:6379",
        DISCORD_PUBLIC_KEY: "a".repeat(64),
        DISCORD_BOT_TOKEN: "discord-bot-token",
        DISCORD_APPLICATION_ID: "123456789012345678",
      }),
    ).not.toThrow();
  });
});
