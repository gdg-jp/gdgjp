import { describe, expect, it } from "vitest";
import { sourceImportDriver } from "./tick";

describe("source import driver registry", () => {
  it("dispatches every durable run kind", () => {
    expect(sourceImportDriver("google-chat-space")?.kind).toBe("google-chat-space");
    expect(sourceImportDriver("discord-channel")?.kind).toBe("discord-channel");
    expect(sourceImportDriver("google-drive")?.kind).toBe("google-drive");
    expect(sourceImportDriver("website")?.kind).toBe("website");
  });

  it("does not request Google credentials for public websites", () => {
    expect(sourceImportDriver("website")).toMatchObject({
      needsAccessToken: false,
      requiredScopes: [],
    });
  });

  it("does not request Google credentials for Discord bot imports", () => {
    expect(sourceImportDriver("discord-channel")).toMatchObject({
      needsAccessToken: false,
      requiredScopes: [],
    });
  });

  it("has ordered, unique phase ladders", () => {
    for (const kind of [
      "google-chat-space",
      "google-drive",
      "website",
      "discord-channel",
    ] as const) {
      const phases = sourceImportDriver(kind)?.phases ?? [];
      expect(phases.length).toBeGreaterThan(0);
      expect(new Set(phases).size).toBe(phases.length);
    }
  });
});
