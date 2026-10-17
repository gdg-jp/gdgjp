import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env, buildPayload, isEnabled, notify } from "./index";

const env: Env = {
  ENABLE_NOTIFICATION: "true",
  CONNPASS_API_BASE_URL: "https://example.test",
  CONNPASS_GROUP_ID: "g1",
  CONNPASS_EVENT_ID: "e1",
  DISCORD_WEBHOOK_URL: "https://discord.test/hook",
};
const stats = { registeredCount: 10, waitlistedCount: 2, canceledCount: 1, checkedInCount: 7 };

afterEach(() => vi.unstubAllGlobals());

describe("attendee-bot", () => {
  it("parses the enable flag", () => {
    expect(isEnabled("true")).toBe(true);
    expect(isEnabled("false")).toBe(false);
    expect(isEnabled(undefined)).toBe(false);
  });

  it("builds an embed with all counts", () => {
    const values = buildPayload(stats).embeds[0].fields.map((f) => f.value);
    expect(values).toEqual(["10", "7", "2", "1"]);
  });

  it("does nothing when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await notify({ ...env, ENABLE_NOTIFICATION: "false" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches stats and posts to Discord", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ statistics: stats }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await notify(env);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/groups/g1/events/e1/stats");
    expect(fetchMock.mock.calls[1][0]).toBe("https://discord.test/hook");
  });
});
