import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { PrActor } from "@gdgjp/gdg-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPermissionsForLink } from "~/features/links/link-permissions.repository";
import { canEditLinkForChapters, canViewLinkForChapters } from "~/features/links/link-policy";
import { getLinkById } from "~/features/links/link.repository";
import { createLinkWithExtras } from "~/features/links/link.service";
import { prCreateLink } from "./pr-service.server";

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
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { sql: string; params: unknown[] }[]) =>
      list.map((s) => run(s.sql, s.params)),
  } as unknown as D1Database;
}

const actor = (id: string, chapterIds: number[]): PrActor => ({
  user: { id, email: `${id}@example.com`, name: id, image: null, isAdmin: false },
  chapters: chapterIds.map((chapterId) => ({
    chapterId,
    chapterSlug: `c${chapterId}`,
    role: "member",
  })),
});

const LEAD = actor("lead", [1]);
const MEMBER = actor("member", [1]);
const OUTSIDER = actor("outsider", [2]);

let raw: DatabaseSync;
let env: Env;

beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../../../schema.sql", import.meta.url), "utf8"));
  raw.exec(`INSERT INTO domains (id, hostname, kind, mode, status)
    VALUES (1, 'gdgs.jp', 'system', 'short-only', 'active')`);
  env = { DB: d1(raw), SHORT_URL_BASE: "https://gdgs.jp" } as unknown as Env;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      Response.json({
        Answer:
          new URL(input.toString()).searchParams.get("type") === "A"
            ? [{ data: "8.8.8.8", type: 1 }]
            : [],
      }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

const origin = { campaignId: 3, draftId: 7, version: 2 };

const create = (who: PrActor, patch: Record<string, unknown> = {}) =>
  prCreateLink(env, {
    actor: who,
    chapterId: 1,
    slug: "df-x-7v2",
    destinationUrl: "https://example.com/b",
    campaignChannelId: null,
    approvedVersion: origin,
    ...patch,
  });

const rows = () =>
  raw
    .prepare("SELECT slug, owner_user_id, visibility, pr_origin, pr_origin_chapter_id FROM links")
    .all();

describe("pr links are idempotent on their approved version", () => {
  it("returns the same link to a second approver, without changing it", async () => {
    const first = await create(LEAD);
    expect(first).toMatchObject({ ok: true, link: { slug: "df-x-7v2" } });
    const second = await create(MEMBER);
    expect(second).toEqual({
      ok: true,
      adopted: true,
      link: first.ok ? first.link : null,
    });
    expect(rows()).toEqual([
      {
        slug: "df-x-7v2",
        owner_user_id: "lead",
        visibility: "private",
        pr_origin: "pr:3:7:2",
        pr_origin_chapter_id: 1,
      },
    ]);
  });

  it("returns the link to a co-host approver pr vouches for, who still cannot view it in tinyurl", async () => {
    const first = await create(LEAD);
    expect(await create(OUTSIDER)).toEqual({
      ok: true,
      adopted: true,
      link: first.ok ? first.link : null,
    });
    expect(rows()).toMatchObject([{ owner_user_id: "lead", visibility: "private" }]);
    const link = first.ok ? await getLinkById(env.DB, first.link.id) : null;
    if (!link) throw new Error("no link");
    const permissions = await listPermissionsForLink(env.DB, link.id);
    expect(canViewLinkForChapters(OUTSIDER.user, [2], link, permissions)).toBe(false);
    expect(canEditLinkForChapters(OUTSIDER.user, [2], link, permissions)).toBe(false);
    expect(canViewLinkForChapters(MEMBER.user, [1], link, permissions)).toBe(false);
  });

  it("returns nothing for the same version claimed for another chapter", async () => {
    await create(LEAD);
    expect(await create(OUTSIDER, { chapterId: 2 })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(rows()).toHaveLength(1);
  });

  it("refuses the same origin with another destination or channel", async () => {
    await create(LEAD);
    expect(await create(MEMBER, { destinationUrl: "https://example.com/a" })).toMatchObject({
      ok: false,
      code: "origin_mismatch",
    });
    expect(rows()).toHaveLength(1);
  });

  it("keeps a different version, and links without an origin, on the plain create", async () => {
    await create(LEAD);
    expect(
      await create(MEMBER, { approvedVersion: { ...origin, version: 3 }, slug: "df-x-7v2" }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await create(LEAD, { approvedVersion: undefined, slug: "plain" })).toMatchObject({
      ok: true,
    });
    expect(await create(MEMBER, { approvedVersion: undefined, slug: "plain" })).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(raw.prepare("SELECT slug, pr_origin FROM links WHERE slug = 'plain'").all()).toEqual([
      { slug: "plain", pr_origin: null },
    ]);
  });

  it("ignores an approved version or origin in a payload that does not come through the pr service", async () => {
    await create(LEAD);
    const payload = {
      domainId: 1,
      slug: "df-x-7v2-copy",
      destinationUrl: "https://example.com/b",
      visibility: "private",
      approvedVersion: origin,
      prOrigin: { key: "pr:3:7:2", chapterId: 1 },
    };
    const actorOf = (who: PrActor) => ({ ...who, selectedChapterId: 1 });
    const created = await createLinkWithExtras({ db: env.DB }, actorOf(MEMBER), payload);
    expect(created).toMatchObject({ ok: true, link: { slug: "df-x-7v2-copy" } });
    expect(
      await createLinkWithExtras({ db: env.DB }, actorOf(OUTSIDER), {
        ...payload,
        slug: "df-x-7v2",
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(raw.prepare("SELECT slug, pr_origin FROM links ORDER BY slug").all()).toEqual([
      { slug: "df-x-7v2", pr_origin: "pr:3:7:2" },
      { slug: "df-x-7v2-copy", pr_origin: null },
    ]);
  });
});
