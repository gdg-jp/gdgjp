import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { describe, expect, it } from "vitest";
import type { CampaignParticipantAnalyticsSnapshot } from "~/lib/campaign-participant-analytics-db";
import {
  aggregateAcquisition,
  getCampaignAnalyticsForActor,
  parseIsoInstant,
} from "./campaign-cli-analytics";

describe("parseIsoInstant", () => {
  it("accepts a well-formed UTC instant", () => {
    const date = parseIsoInstant("2026-01-15T12:30:00Z");
    expect(date?.toISOString()).toBe("2026-01-15T12:30:00.000Z");
  });

  it("accepts fractional seconds", () => {
    expect(parseIsoInstant("2026-01-15T12:30:00.123Z")).not.toBeNull();
  });

  it.each([
    "0",
    "",
    "not-a-date",
    "2026-01-15", // date only, no time — not an instant
    "2026-01-15T12:30:00", // missing Z / offset
    "2026-01-15T12:30:00+09:00", // non-Z offset, out of scope for this contract
    "2026-02-30T00:00:00Z", // calendar rollover: JS Date would silently normalize this to Mar 2
    "2026-13-01T00:00:00Z", // invalid month
  ])("rejects a non-instant or invalid calendar string: %s", (value) => {
    expect(parseIsoInstant(value)).toBeNull();
  });
});

function baseSnapshot(
  overrides: Partial<CampaignParticipantAnalyticsSnapshot> = {},
): CampaignParticipantAnalyticsSnapshot {
  return {
    campaignId: 1,
    connpassEventId: "123",
    importedByUserId: "user_x",
    selectedQuestions: [],
    channelMappings: [],
    participants: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("aggregateAcquisition", () => {
  it("returns null when there is no participant snapshot", () => {
    expect(aggregateAcquisition(null, [], { kind: "all" }, { amount: 1, unit: "day" })).toBeNull();
  });

  it("caps the channels list at 10 entries even when more channels have applicants", () => {
    const channels = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      name: `Channel ${i + 1}`,
    }));
    const participants = channels.map((channel, i) => ({
      participantId: `p${i}`,
      participationType: "general",
      participationStatus: "approved",
      attendanceStatus: "",
      registeredAt: "2026-01-15T00:00:00.000Z",
      lastUpdatedAt: null,
      channelIds: [channel.id],
    }));
    const snapshot = baseSnapshot({ participants });

    const acquisition = aggregateAcquisition(
      snapshot,
      channels,
      { kind: "all" },
      {
        amount: 1,
        unit: "day",
      },
    );

    expect(acquisition).not.toBeNull();
    expect(acquisition?.channels.length).toBeLessThanOrEqual(10);
  });
});

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

function chapter(chapterId: number): UserChapter {
  return { chapterId, chapterSlug: `chapter-${chapterId}`, role: "organizer" };
}

type Row = Record<string, unknown>;

/** A minimal D1 stand-in covering an empty-links campaign with an imported participant snapshot. */
function fakeAnalyticsDb(): D1Database {
  const campaignRow: Row = {
    id: 5,
    name: "DevFest 2026",
    code: "df26",
    default_destination_url: null,
    owner_user_id: "user_owner",
    created_at: 1700000000,
    updated_at: 1700000000,
    archived_at: null,
  };
  const analyticsRow: Row = {
    campaign_id: 5,
    connpass_event_id: "123",
    imported_by_user_id: "user_x",
    created_at: 1700000000,
    updated_at: 1700000000,
  };
  const participantRow: Row = {
    participant_id: "p1",
    participation_type: "general",
    participation_status: "approved",
    attendance_status: "",
    registered_at: "2026-01-15T00:00:00.000Z",
    last_updated_at: null,
    channel_id: null,
  };

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const first = (): Row | null => {
      if (sql.includes("FROM campaigns WHERE id = ?")) return campaignRow;
      if (sql.includes("FROM campaign_participant_analytics WHERE campaign_id = ?")) {
        return analyticsRow;
      }
      throw new Error(`Unhandled SQL (first) in fake analytics db: ${sql}`);
    };
    const all = (): Row[] => {
      if (sql.includes("FROM campaign_chapters")) return [{ campaign_id: 5, chapter_id: 42 }];
      if (sql.includes("FROM campaign_channels")) return [];
      if (sql.includes("FROM campaign_channel_sources s")) return [];
      if (sql.includes("FROM links l")) return [];
      if (sql.includes("FROM campaign_participant_questions")) return [];
      if (sql.includes("FROM campaign_participant_channel_mappings")) return [];
      if (sql.includes("FROM campaign_participants p")) return [participantRow];
      throw new Error(`Unhandled SQL (all) in fake analytics db: ${sql}`);
    };
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first() {
        void bound;
        return first();
      },
      async all() {
        return { results: all() };
      },
    } as unknown as D1PreparedStatement;
  }
  return { prepare } as unknown as D1Database;
}

describe("getCampaignAnalyticsForActor", () => {
  it("still computes acquisition from the participant snapshot when the campaign has no links", async () => {
    const db = fakeAnalyticsDb();
    const env = { DB: db } as unknown as Env;
    const actor = { user: user(), chapters: [chapter(42)] };

    const result = await getCampaignAnalyticsForActor(env, actor, 5, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-31T23:59:59Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analytics.totalClicks).toBe(0);
    expect(result.analytics.links).toEqual([]);
    expect(result.analytics.sources).toEqual([]);
    expect(result.analytics.acquisition).not.toBeNull();
    expect(result.analytics.acquisition?.applications).toBe(1);
  });
});
