import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it, vi } from "vitest";
import {
  archiveCampaignChannelForActor,
  createCampaignForActor,
  restoreCampaignChannelForActor,
  updateCampaignChannelForActor,
  updateCampaignForActor,
} from "./campaign.service";

type Row = Record<string, unknown>;

function dnsResponse(addresses: Array<{ data: string; type: number }>) {
  return Response.json({ Answer: addresses });
}

/** Stubs the DNS-over-HTTPS lookup `validatePublicHttpUrl` makes to resolve a hostname. */
function stubPublicDns() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      return url.searchParams.get("type") === "A"
        ? dnsResponse([{ data: "8.8.8.8", type: 1 }])
        : dnsResponse([]);
    }),
  );
}

/**
 * A minimal in-memory D1 stand-in covering only the SQL shapes the campaign
 * repository issues for a campaign + its channels, so the service layer's
 * chapter-membership gate can be exercised end-to-end (not just the isolated
 * policy predicate).
 */
function fakeCampaignsDb(campaigns: Row[], chapterLinks: Row[], channels: Row[]): D1Database {
  function prepare(sql: string) {
    let bound: unknown[] = [];
    const exec = (): Row[] => {
      if (sql.startsWith("SELECT id, name, code, default_destination_url")) {
        const [id] = bound;
        const row = campaigns.find((c) => c.id === id);
        return row ? [row] : [];
      }
      if (sql.startsWith("SELECT campaign_id, chapter_id FROM campaign_chapters")) {
        const ids = new Set(bound);
        return chapterLinks.filter((row) => ids.has(row.campaign_id));
      }
      if (sql.startsWith("SELECT id, campaign_id, name, code, sort_order")) {
        const [id] = bound;
        const row = channels.find((c) => c.id === id);
        return row ? [row] : [];
      }
      if (sql.includes("UPDATE campaign_channels") && sql.includes("RETURNING")) {
        const id = bound.at(-1);
        const row = channels.find((c) => c.id === id);
        if (!row) return [];
        const values = bound.slice(0, -1);
        let index = 0;
        if (sql.includes("name = ?")) row.name = values[index++];
        if (sql.includes("code = ?")) row.code = values[index++];
        if (sql.includes("sort_order = ?")) row.sort_order = values[index++];
        if (sql.includes("archived_at = CASE")) {
          row.archived_at = values[index] === 1 ? 1700000000 : null;
        }
        return [row];
      }
      if (sql.startsWith("UPDATE campaigns SET") && sql.includes("RETURNING")) {
        const id = bound.at(-1);
        const row = campaigns.find((c) => c.id === id);
        if (!row) return [];
        const values = bound.slice(0, -1);
        let index = 0;
        if (sql.includes("name = ?")) row.name = values[index++];
        if (sql.includes("code = ?")) row.code = values[index++];
        if (sql.includes("default_destination_url = ?"))
          row.default_destination_url = values[index++];
        return [row];
      }
      throw new Error(`Unhandled SQL in fake campaigns db: ${sql}`);
    };
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first() {
        return exec()[0] ?? null;
      },
      async all() {
        return { results: exec() };
      },
    } as unknown as D1PreparedStatement;
  }
  return { prepare } as unknown as D1Database;
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user_caller",
    email: "caller@example.com",
    name: "Caller",
    image: null,
    isAdmin: false,
    ...overrides,
  };
}

function chapter(chapterId: number, role: UserChapter["role"] = "organizer"): UserChapter {
  return { chapterId, chapterSlug: `chapter-${chapterId}`, role };
}

function fixtures() {
  const campaigns: Row[] = [
    {
      id: 1,
      name: "DevFest 2026",
      code: "df26",
      default_destination_url: null,
      owner_user_id: "user_owner",
      created_at: 1700000000,
      updated_at: 1700000000,
      archived_at: null,
    },
  ];
  const chapterLinks: Row[] = [{ campaign_id: 1, chapter_id: 42 }];
  const channels: Row[] = [
    {
      id: 10,
      campaign_id: 1,
      name: "X",
      code: "x",
      sort_order: 0,
      archived_at: null,
    },
  ];
  return { campaigns, chapterLinks, channels };
}

describe("campaign chapter-membership regression", () => {
  it("lets a non-owner organizer who belongs to a campaign chapter update, archive, and restore a channel", async () => {
    const { campaigns, chapterLinks, channels } = fixtures();
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    const actor = { user: user(), chapters: [chapter(42, "organizer")] };

    const updated = await updateCampaignChannelForActor(db, actor, 1, 10, { name: "Renamed" });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.channel.name).toBe("Renamed");

    const archived = await archiveCampaignChannelForActor(db, actor, 1, 10);
    expect(archived.ok).toBe(true);
    if (archived.ok) expect(archived.channel.archivedAt).not.toBeNull();

    const restored = await restoreCampaignChannelForActor(db, actor, 1, 10);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.channel.archivedAt).toBeNull();
  });

  it("returns 403 for a caller outside every campaign chapter, even with a guessable sequential id", async () => {
    const { campaigns, chapterLinks, channels } = fixtures();
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    const actor = { user: user(), chapters: [chapter(99, "organizer")] };

    const result = await updateCampaignChannelForActor(db, actor, 1, 10, { name: "Hijacked" });
    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      error: "You do not have access to this campaign.",
    });
  });

  it("does not grant access from ownerUserId alone for a caller outside every campaign chapter", async () => {
    const { campaigns, chapterLinks, channels } = fixtures();
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    // The caller IS campaign.ownerUserId, but belongs to none of its chapters.
    const actor = { user: user({ id: "user_owner" }), chapters: [chapter(99, "organizer")] };

    const result = await updateCampaignChannelForActor(db, actor, 1, 10, { name: "Hijacked" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("defaultDestinationUrl validation", () => {
  it("rejects a non-http(s) scheme on create without touching the database", async () => {
    const db = {
      prepare(): never {
        throw new Error("should not query D1 — validation must short-circuit first");
      },
    } as unknown as D1Database;
    const actor = { user: user(), chapters: [chapter(42)] };

    const result = await createCampaignForActor(db, actor, {
      name: "DevFest 2026",
      code: "df26",
      defaultDestinationUrl: "ftp://example.com/file",
      chapterIds: [42],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_input");
      expect(result.error).toContain("Default destination URL");
    }
  });

  it("rejects a non-http(s) scheme on update", async () => {
    const { campaigns, chapterLinks, channels } = fixtures();
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    const actor = { user: user(), chapters: [chapter(42)] };

    const result = await updateCampaignForActor(db, actor, 1, {
      defaultDestinationUrl: "javascript:alert(1)",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_input");
  });

  it("leaves the default destination untouched when the field is omitted from the patch", async () => {
    const { campaigns, chapterLinks, channels } = fixtures();
    campaigns[0].default_destination_url = "https://example.com/original";
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    const actor = { user: user(), chapters: [chapter(42)] };

    const result = await updateCampaignForActor(db, actor, 1, { name: "Renamed" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.campaign.defaultDestinationUrl).toBe("https://example.com/original");
    }
  });

  it("validates and canonicalizes a public http(s) URL on update", async () => {
    stubPublicDns();
    const { campaigns, chapterLinks, channels } = fixtures();
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    const actor = { user: user(), chapters: [chapter(42)] };

    const result = await updateCampaignForActor(db, actor, 1, {
      defaultDestinationUrl: "https://example.com/devfest",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.campaign.defaultDestinationUrl).toBe("https://example.com/devfest");
    }
  });

  it("clears the default destination when explicitly set to null", async () => {
    const { campaigns, chapterLinks, channels } = fixtures();
    campaigns[0].default_destination_url = "https://example.com/original";
    const db = fakeCampaignsDb(campaigns, chapterLinks, channels);
    const actor = { user: user(), chapters: [chapter(42)] };

    const result = await updateCampaignForActor(db, actor, 1, { defaultDestinationUrl: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.campaign.defaultDestinationUrl).toBeNull();
  });
});
