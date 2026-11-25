import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import type { Asset } from "./asset";
import { approveAsset } from "./distribute.server";

function d1(raw: DatabaseSync): D1Database {
  const run = (sql: string, params: unknown[]) => {
    const statement = raw.prepare(sql);
    if (/^\s*SELECT|RETURNING/i.test(sql))
      return { results: statement.all(...(params as never[])), meta: { changes: 0 } };
    const result = statement.run(...(params as never[]));
    return { results: [], meta: { changes: Number(result.changes) } };
  };
  const statement = (sql: string, params: unknown[] = []) => ({
    sql,
    params,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => run(sql, params),
    run: async () => run(sql, params),
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

const access = {
  user: { id: "lead", name: "lead", email: "lead@example.com", image: null, isAdmin: false },
  chapters: [{ chapterId: 1, chapterSlug: "c1", role: "organizer" }],
  campaign: { id: 1, slug: "devfest", chapterId: 1, tinyurlCampaignId: 7 },
} as unknown as CampaignAccess;

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../../../schema.sql", import.meta.url), "utf8"));
  raw.exec(`
    INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by)
      VALUES (1, 1, 'c1', 'devfest', 'DevFest', 'v1', 'lead');
    INSERT INTO schedule_items (id, campaign_id, kind, channel, due_at, title)
      VALUES (1, 1, 'x_post', 'x', 1900000000, 'post');
    INSERT INTO drafts (id, campaign_id, schedule_item_id, kind, title, status, current_version, approved_version)
      VALUES (1, 1, 1, 'x_post', 'post', 'approved', 2, 2);
    INSERT INTO campaign_links (campaign_id, schedule_item_id, tinyurl_link_id, short_url, slug,
        destination_url, draft_id, draft_version)
      VALUES (1, 1, 'link-v2', 'https://gdgs.jp/df-x-1v2', 'df-x-1v2', 'https://example.com', 1, 2);
    INSERT INTO assets (id, campaign_id, template_id, slots, skin, width, height, r2_key, status,
        for_schedule_item_id, author, playbook_version)
      VALUES (5, 1, 'ogp-1200x630', '{}', '{}', 1200, 630, 'assets/5.png', 'needs_approval', 1,
        'generator', 'v1');
  `);
  const updates: unknown[] = [];
  const env = {
    DB: d1(raw),
    IMAGES: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(4) }) },
    IMG_UPLOAD: { upload: async () => ({ id: "img-1", url: "https://img.gdgs.jp/ogp.png" }) },
    TINYURL: {
      updateLink: async (input: { linkId: string; chapterId: number; ogImageUrl: string }) => {
        updates.push({
          linkId: input.linkId,
          chapterId: input.chapterId,
          ogImageUrl: input.ogImageUrl,
        });
        return { ok: true, link: { id: input.linkId, slug: "df-x-1v2", shortUrl: "x" } };
      },
    },
  } as unknown as Env;
  const asset = {
    id: 5,
    campaignId: 1,
    templateId: "ogp-1200x630",
    purpose: "image",
    checks: [],
    r2Key: "assets/5.png",
    forDraftId: null,
    forScheduleItemId: 1,
    forImageSlotId: null,
  } as unknown as Asset;
  return { raw, env, asset, updates };
}

describe("an approved OGP image goes onto the approved version's short link", () => {
  it("asks tinyurl to update its own link for the campaign's chapter and records the image", async () => {
    const { raw, env, asset, updates } = setup();
    const result = await approveAsset(env, access, asset);
    expect(result).toMatchObject({ ok: true });
    expect(updates).toEqual([
      { linkId: "link-v2", chapterId: 1, ogImageUrl: "https://img.gdgs.jp/ogp.png" },
    ]);
    expect(raw.prepare("SELECT og_image_url FROM campaign_links").get()).toEqual({
      og_image_url: "https://img.gdgs.jp/ogp.png",
    });
  });
});
