import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";
import { createFakeKnowledge } from "./fake-binding";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("~/lib/db.server", () => ({ getDb: () => state.db }));

import { processKnowledgeSync, syncSpaceKnowledge } from "./sync.server";
import { searchForReader } from "./viewer-search.server";

function setup() {
  const { db, sqlite } = createSpacesTestDb();
  state.db = db;
  const fake = createFakeKnowledge();
  const objects = new Map<string, string>();
  const env = {
    KNOWLEDGE: fake.binding,
    APP_URL: "https://wiki.example",
    SOURCE_FETCH_QUEUE: { send: vi.fn() },
    BUCKET: {
      get: async (key: string) =>
        objects.has(key)
          ? { size: objects.get(key)?.length ?? 0, text: async () => objects.get(key) }
          : null,
    },
    DB: {
      prepare: (sql: string) => {
        const statement = sqlite.prepare(sql);
        let args: unknown[] = [];
        const api = {
          bind: (...values: unknown[]) => {
            args = values;
            return api;
          },
          all: async () => ({ results: statement.all(...(args as never[])) }),
          first: async () => statement.get(...(args as never[])),
        };
        return api;
      },
    },
  } as unknown as Env;
  sqlite.exec(`
    INSERT INTO sources (id, kind, url, title, added_by, status, visibility)
      VALUES ('org', 'website', 'https://o.example', 'Org notes', 'alice', 'ready', 'organizer');
    INSERT INTO pages (id, title_ja, slug, content_ja, author_id, last_edited_by, visibility, origin)
      VALUES ('p1', '会場', 'venue', '会場は梅田。<acl src="org">契約は 12 万円。</acl>', 'alice', 'alice', 'member', 'agent');
    INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at)
      VALUES ('d1', 'org', 'a.md', 'Org doc', 'raw-key', 'h1', 0);
  `);
  objects.set("raw-key", "議事録: 契約は 12 万円");
  return { env, db, sqlite, fake };
}

describe("syncSpaceKnowledge", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("mirrors pages without span text and tags spans / raw with their audience", async () => {
    const result = await syncSpaceKnowledge(ctx.env, "gdg-jp");
    expect(result.done).toBe(true);
    const items = ctx.fake.instances.get("gdg-jp");
    expect(items?.get("pages/p1.ja.md")?.body).not.toContain("12 万円");
    expect(items?.get("pages/p1.ja.md")?.metadata).toMatchObject({
      layer: "page",
      audience: "page",
    });
    expect(items?.get("acl/organizer/p1.ja.md")?.body).toContain("12 万円");
    expect(items?.get("raw/d1.md")?.metadata).toMatchObject({
      layer: "raw",
      audience: "organizer",
    });
  });

  it("is a no-op when nothing changed, and removes items of archived pages", async () => {
    await syncSpaceKnowledge(ctx.env, "gdg-jp");
    expect(await syncSpaceKnowledge(ctx.env, "gdg-jp")).toMatchObject({ uploaded: 0, deleted: 0 });
    ctx.sqlite.exec("UPDATE pages SET status = 'archived' WHERE id = 'p1'");
    await syncSpaceKnowledge(ctx.env, "gdg-jp");
    const keys = [...(ctx.fake.instances.get("gdg-jp")?.keys() ?? [])];
    expect(keys).toEqual(["raw/d1.md"]);
  });

  it("re-tags raw items when the source's visibility changes", async () => {
    await syncSpaceKnowledge(ctx.env, "gdg-jp");
    ctx.sqlite.exec("UPDATE sources SET visibility = 'member' WHERE id = 'org'");
    await syncSpaceKnowledge(ctx.env, "gdg-jp");
    expect(ctx.fake.instances.get("gdg-jp")?.get("raw/d1.md")?.metadata.audience).toBe("member");
  });
});

describe("searchForReader", () => {
  it("passes only the reader's audiences and drops pages the page ACL hides", async () => {
    const ctx = setup();
    ctx.sqlite.exec(`INSERT INTO pages (id, title_ja, slug, content_ja, author_id, last_edited_by, visibility)
      VALUES ('secret', '秘密', 'secret', '本文', 'alice', 'alice', 'restricted')`);
    ctx.fake.setNextChunks([
      {
        id: "c1",
        score: 0.9,
        text: "会場は梅田",
        instance_id: "gdg-jp",
        item: { key: "pages/p1.ja.md", metadata: { layer: "page", audience: "page" } },
      },
      {
        id: "c2",
        score: 0.8,
        text: "本文",
        instance_id: "gdg-jp",
        item: { key: "pages/secret.ja.md", metadata: { layer: "page", audience: "page" } },
      },
      // An organizer item the filter should have excluded: the port drops it anyway.
      {
        id: "c3",
        score: 0.7,
        text: "12 万円",
        instance_id: "gdg-jp",
        item: { key: "acl/organizer/p1.ja.md", metadata: { layer: "acl", audience: "organizer" } },
      },
    ]);
    const reader = {
      user: { id: "bob", isAdmin: false, email: "bob@example.com" },
      chapters: [{ chapterId: "tokyo", role: "member" }],
      claimsAvailable: true,
    };
    const { pages } = await searchForReader(ctx.env, ctx.db, reader, {
      spaceIds: ["gdg-jp"],
      query: "会場",
    });
    const filters = ctx.fake.searches[0]?.ai_search_options.retrieval.filters as {
      audience: { $in: string[] };
      layer: { $in: string[] };
    };
    expect(filters.audience.$in).not.toContain("organizer");
    expect(filters.layer.$in).toEqual(["page", "acl"]);
    expect(pages.map((page) => page.slug)).toEqual(["venue"]);
    expect(pages[0]?.matchedChunks.map((chunk) => chunk.text)).toEqual(["会場は梅田"]);
  });
});

describe("processKnowledgeSync without a remote binding", () => {
  it("acks instead of retrying when AI Search is remote-only (local dev / e2e)", async () => {
    const { env } = setup();
    const send = vi.fn();
    const local = {
      ...env,
      SOURCE_FETCH_QUEUE: { send },
      get KNOWLEDGE(): never {
        throw Object.assign(new Error("Binding KNOWLEDGE needs to be run remotely"), {
          remote: true,
        });
      },
    };
    await expect(
      processKnowledgeSync(local as unknown as Env, { type: "knowledge_sync", spaceId: "gdg-jp" }),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
