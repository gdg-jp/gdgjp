import { describe, expect, it } from "vitest";
import { discordBody, isWebhookUrl, maskWebhook, renderTemplate } from "./discord";

describe("isWebhookUrl", () => {
  it("accepts Discord webhooks and loopback only in development", () => {
    expect(isWebhookUrl("https://discord.com/api/webhooks/123/abc-DEF_9", false)).toBe(true);
    expect(isWebhookUrl("https://evil.example/api/webhooks/123/abc", false)).toBe(false);
    expect(isWebhookUrl("http://discord.com/api/webhooks/123/abc", false)).toBe(false);
    expect(isWebhookUrl("http://127.0.0.1:5299/hook", false)).toBe(false);
    expect(isWebhookUrl("http://127.0.0.1:5299/hook", true)).toBe(true);
  });
});

describe("maskWebhook", () => {
  it("never shows the token", () => {
    const masked = maskWebhook("https://discord.com/api/webhooks/123456789/secret-token");
    expect(masked).not.toContain("secret-token");
    expect(masked).toContain("1234");
  });
});

describe("renderTemplate", () => {
  it("fills known names, drops unknown ones and empty lines", () => {
    expect(renderTemplate("{{a}} x {{b}}\n{{c}}\nend", { a: "A", c: "" })).toBe("A x \nend");
  });
});

describe("discordBody", () => {
  it("pings nobody and keeps Discord's length limit", () => {
    const body = discordBody("x".repeat(3000));
    expect(body.allowed_mentions.parse).toEqual([]);
    expect(body.content.length).toBe(2000);
  });
});
