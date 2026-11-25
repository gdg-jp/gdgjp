import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { PrActor } from "@gdgjp/gdg-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkWithExtras } from "~/features/links/link.service";
import { prCreateLink, prUpdateLink } from "./pr-service.server";

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
const OGP = "https://img.example/ogp.png";

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

async function prVersionLink() {
  const created = await prCreateLink(env, {
    actor: LEAD,
    chapterId: 1,
    slug: "df-x-7v2",
    destinationUrl: "https://example.com/b",
    campaignChannelId: null,
    approvedVersion: { campaignId: 3, draftId: 7, version: 2 },
  });
  if (!created.ok) throw new Error(created.code);
  return created.link.id;
}

async function plainLink(owner: PrActor, chapterId: number, slug: string) {
  const created = await createLinkWithExtras(
    { db: env.DB },
    { ...owner, selectedChapterId: chapterId },
    {
      domainId: 1,
      chapterId,
      slug,
      destinationUrl: "https://example.com/own",
      visibility: "private",
    },
  );
  if (!created.ok) throw new Error(created.code);
  return created.link.id;
}

const stored = (id: string) =>
  raw.prepare("SELECT destination_url, og_image_url, slug FROM links WHERE id = ?").get(id);

const update = (who: PrActor, chapterId: number, linkId: string, extra = {}) =>
  prUpdateLink(env, { actor: who, chapterId, linkId, ogImageUrl: OGP, ...extra });

const refused = { ok: false, code: "not_found", message: "Link not found." };

describe("pr updates only the links it created for an approved version", () => {
  it("sets the OGP image of its own link for the chapter it was created for", async () => {
    const id = await prVersionLink();
    expect(await update(MEMBER, 1, id)).toMatchObject({ ok: true, link: { id } });
    expect(stored(id)).toMatchObject({ og_image_url: OGP });
  });

  it("refuses its own link named for another chapter", async () => {
    const id = await prVersionLink();
    expect(await update(OUTSIDER, 2, id)).toEqual(refused);
    expect(stored(id)).toMatchObject({ og_image_url: null });
  });

  it("refuses a link made in tinyurl by someone else, exactly as it refuses a missing one", async () => {
    const id = await plainLink(actor("owner", [5]), 5, "theirs");
    expect(await update(OUTSIDER, 5, id)).toEqual(refused);
    expect(await update(OUTSIDER, 5, "does-not-exist")).toEqual(refused);
    expect(stored(id)).toEqual({
      destination_url: "https://example.com/own",
      og_image_url: null,
      slug: "theirs",
    });
  });

  it("changes nothing but the OGP image, whatever else the payload carries", async () => {
    const id = await prVersionLink();
    const result = await update(MEMBER, 1, id, {
      destinationUrl: "https://evil.example/",
      slug: "taken-over",
    });
    expect(result).toMatchObject({ ok: true });
    expect(stored(id)).toEqual({
      destination_url: "https://example.com/b",
      og_image_url: OGP,
      slug: "df-x-7v2",
    });
  });
});

describe("a link pr made before links carried an origin", () => {
  it("is updated only for a user who could edit it in tinyurl", async () => {
    const id = await plainLink(LEAD, 1, "df-x-legacy");
    expect(await update(OUTSIDER, 1, id)).toEqual(refused);
    expect(await update(MEMBER, 1, id)).toEqual(refused);
    expect(stored(id)).toMatchObject({ og_image_url: null });
    expect(await update(LEAD, 1, id)).toMatchObject({ ok: true });
    expect(stored(id)).toMatchObject({ og_image_url: OGP });
  });
});
