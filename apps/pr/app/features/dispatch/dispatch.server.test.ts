import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { sendDueMails } from "~/features/connpass/mail.server";
import { MINUTE_CRON, runCron } from "~/features/cron/cron.server";
import { draftAction } from "~/features/drafts/detail.server";
import {
  appendVersion,
  getDraftById,
  latestVersion,
} from "~/features/drafts/draft.repository.server";
import { STALE_VERSION, reviewDraft } from "~/features/drafts/review.server";
import { deliveryAction } from "./delivery.server";
import { approveTarget } from "./dispatch.server";
import { dueMailTargets, ensureTargets, listTargets } from "./target.repository.server";

type Hook = { match: string; run: () => Promise<void> };

function sqlite(sql: string) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(sql);
  return raw;
}

function d1(raw: DatabaseSync) {
  const hooks: Hook[] = [];
  const fire = async (sql: string) => {
    const index = hooks.findIndex((hook) => sql.includes(hook.match));
    if (index >= 0) await hooks.splice(index, 1)[0]?.run();
  };
  const execute = (sql: string, params: unknown[]) => {
    const statement = raw.prepare(sql);
    if (/^\s*SELECT|RETURNING/i.test(sql)) {
      return { results: statement.all(...(params as never[])), meta: { changes: 0 } };
    }
    const result = statement.run(...(params as never[]));
    return { results: [], meta: { changes: Number(result.changes) } };
  };
  const statement = (sql: string, params: unknown[] = []) => ({
    sql,
    params,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => {
      const row = raw.prepare(sql).get(...(params as never[])) ?? null;
      await fire(sql);
      return row;
    },
    all: async () => {
      const result = execute(sql, params);
      await fire(sql);
      return result;
    },
    run: async () => {
      const result = execute(sql, params);
      await fire(sql);
      return result;
    },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: { sql: string; params: unknown[] }[]) => {
      raw.exec("BEGIN");
      const results = statements.map((s) => execute(s.sql, s.params));
      raw.exec("COMMIT");
      for (const s of statements) await fire(s.sql);
      return results;
    },
  };
  return {
    db: db as unknown as D1Database,
    after: (match: string, run: () => Promise<void>) => hooks.push({ match, run }),
  };
}

const schema = () => readFileSync(new URL("../../../schema.sql", import.meta.url), "utf8");

const user = (id: string, chapterId: number, role: "member" | "organizer") => ({
  id,
  name: id,
  email: `${id}@example.com`,
  image: null,
  isAdmin: false,
  chapters: [{ chapterId, slug: `c${chapterId}`, role }],
});

function accessFor(who: ReturnType<typeof user>, manage: boolean): CampaignAccess {
  return {
    user: { id: who.id, name: who.name, email: who.email, image: who.image, isAdmin: false },
    chapters: who.chapters,
    campaign: {
      id: 1,
      slug: "devfest",
      chapterId: 1,
      tinyurlCampaignId: 7,
      connpassGroupSlug: "group-2",
      connpassEventId: "99",
    },
    campaignChapters: [],
    members: [
      { userId: "lead", roles: ["lead"] },
      { userId: "cohost", roles: [] },
      { userId: "member1", roles: [] },
    ],
    permissions: { manage, edit: true },
  } as unknown as CampaignAccess;
}

const LEAD = user("lead", 1, "organizer");
const COHOST = user("cohost", 2, "member");
const HOST_MEMBER = user("member1", 1, "member");

type Content = (n: number) => unknown;

const plain = (kind: "x_post" | "connpass_mail"): Content =>
  kind === "x_post"
    ? (n) => ({ posts: [{ text: `post v${n}` }] })
    : (n) => ({ subject: `subject v${n}`, text: `body v${n}` });

type TinyurlLink = {
  destinationUrl: string;
  ownerUserId: string;
  ownerChapterId: number | null;
  campaignChannelId: number | null;
  origin?: string | null;
  originChapterId?: number | null;
};

type TinyurlInput = {
  actor: { user: { id: string }; chapters: { chapterId: number }[] };
  chapterId: number;
  slug: string;
  destinationUrl: string;
  campaignChannelId: number | null;
  approvedVersion?: { campaignId: number; draftId: number; version: number };
};

function seeded(kind: "x_post" | "connpass_mail") {
  const raw = sqlite(schema());
  raw.exec(`
    INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by,
      connpass_group_slug, connpass_event_id, tinyurl_campaign_id)
      VALUES (1, 1, 'c1', 'devfest', 'DevFest', 'v1', 'lead', 'group-2', '99', 7);
    INSERT INTO schedule_items (id, campaign_id, kind, due_at, title, status)
      VALUES (1, 1, '${kind}', 0, 'item', 'in_review');
    INSERT INTO drafts (id, campaign_id, kind, schedule_item_id, title, status)
      VALUES (1, 1, '${kind}', 1, 'draft', 'generating');
    INSERT INTO campaign_accounts (id, campaign_id, kind, chapter_id, external_id, label, role)
      VALUES (1, 1, '${kind === "x_post" ? "x" : "connpass_group"}', 2,
        '${kind === "x_post" ? "x-2" : "group-2"}', 'cohost-account', 'mirror');
  `);
  return raw;
}

function setup(
  kind: "x_post" | "connpass_mail",
  content: Content = plain(kind),
  raw: DatabaseSync = seeded(kind),
) {
  const { db, after } = d1(raw);
  const posts: string[] = [];
  const actors: string[] = [];
  const media: string[] = [];
  const mails: string[] = [];
  const pages: string[] = [];
  const tinyurl = {
    down: false,
    calls: [] as { slug: string; destinationUrl: string }[],
    links: new Map<string, TinyurlLink>(),
    originAware: true,
  };
  const summary = (slug: string) => ({
    id: `link-${[...tinyurl.links.keys()].indexOf(slug) + 1}`,
    slug,
    shortUrl: `https://gdgs.jp/${slug}`,
  });
  const adopt = (input: TinyurlInput, key: string) => {
    const found = [...tinyurl.links.entries()].find(([, link]) => link.origin === key);
    if (!found) return null;
    const [slug, link] = found;
    if (link.originChapterId !== input.chapterId) return { ok: false, code: "not_found" };
    if (
      link.destinationUrl !== input.destinationUrl ||
      link.campaignChannelId !== input.campaignChannelId
    )
      return { ok: false, code: "origin_mismatch" };
    return { ok: true, adopted: true, link: summary(slug) };
  };
  const env = {
    DB: db,
    TINYURL: {
      createLink: async (input: TinyurlInput) => {
        tinyurl.calls.push({ slug: input.slug, destinationUrl: input.destinationUrl });
        if (tinyurl.down) return { ok: false, code: "unavailable" };
        const o = tinyurl.originAware ? input.approvedVersion : undefined;
        const key = o ? `pr:${o.campaignId}:${o.draftId}:${o.version}` : null;
        const adopted = key ? adopt(input, key) : null;
        if (adopted) return adopted;
        if (tinyurl.links.has(input.slug)) return { ok: false, code: "conflict" };
        tinyurl.links.set(input.slug, {
          destinationUrl: input.destinationUrl,
          ownerUserId: input.actor.user.id,
          ownerChapterId: input.campaignChannelId === null ? null : input.chapterId,
          campaignChannelId: input.campaignChannelId,
          origin: key,
          originChapterId: key ? input.chapterId : null,
        });
        return { ok: true, link: summary(input.slug) };
      },
    },
    SNS: {
      createScheduledPost: async (input: { text: string; actor: { user: { id: string } } }) => {
        posts.push(input.text);
        actors.push(input.actor.user.id);
        return { ok: true, post: { id: `sns-${posts.length}` } };
      },
      attachMedia: async (input: { postId: string; bytes: ArrayBuffer }) => {
        media.push(`${input.postId} ${new TextDecoder().decode(input.bytes)}`);
        return { ok: true, mediaId: `media-${media.length}` };
      },
    },
    CONNPASS: {
      updateEvent: async (input: { fields: { description: string } }) => {
        pages.push(input.fields.description);
        return { ok: true, job: { id: `page-${pages.length}`, status: "queued" } };
      },
      sendMessage: async (input: { subject: string; body: string }) => {
        mails.push(`${input.subject}|${input.body}`);
        return { ok: true, job: { id: `job-${mails.length}`, status: "queued" } };
      },
    },
  } as unknown as Env;
  const save = (n: number) =>
    appendVersion(db, 1, {
      author: "agent",
      userId: null,
      jobId: null,
      content: content(n),
      playbookVersion: "v1",
      checkResults: [],
      status: "in_review",
      itemStatus: "in_review",
    });
  const draft = async () => {
    const found = await getDraftById(db, 1);
    if (!found) throw new Error("no draft");
    return found;
  };
  const approveDraft = async (version: number) =>
    reviewDraft(db, accessFor(LEAD, true), await draft(), "approve", version, null);
  const approveAsCohost = async (version: number, targetId = 1) =>
    approveTarget(env, accessFor(COHOST, false), await draft(), targetId, version);
  const setMedia = async (url: string) => {
    const form = new FormData();
    form.set("mediaUrl", url);
    return deliveryAction(env, accessFor(LEAD, true), await draft(), "media", form);
  };
  const press = async (who: ReturnType<typeof user>, manage: boolean, version: number) => {
    const form = new FormData();
    form.set("intent", "approve");
    form.set("version", String(version));
    return draftAction(env, accessFor(who, manage), 1, form);
  };
  return {
    raw,
    db,
    env,
    after,
    posts,
    actors,
    media,
    mails,
    pages,
    tinyurl,
    save,
    draft,
    approveDraft,
    approveAsCohost,
    setMedia,
    press,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function serveImages() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      new Response(String(input), { headers: { "content-type": "image/png" } }) as Response,
  );
}

async function approvedButUnclaimed() {
  const t = await approvedWithTarget("x_post");
  t.after("SET status = 'approved', approved_version", async () => {
    throw new Error("worker stopped");
  });
  await expect(t.approveAsCohost(1)).rejects.toThrow("worker stopped");
  expect(t.posts).toEqual([]);
  expect((await listTargets(t.db, 1))[0]).toMatchObject({ status: "approved", approvedVersion: 1 });
  return t;
}

async function approvedWithTarget(kind: "x_post" | "connpass_mail") {
  const t = setup(kind);
  await t.save(1);
  expect(await t.approveDraft(1)).toMatchObject({ ok: true });
  await ensureTargets(t.db, 1, 1, kind === "x_post" ? "x" : "connpass_group");
  return t;
}

describe("a draft approval names the version it approves", () => {
  it("F3: refuses an approve pressed on a version that is no longer the latest", async () => {
    const t = setup("x_post");
    await t.save(1);
    await t.save(2);
    const result = await t.approveDraft(1);
    expect(result.ok).toBe(false);
    expect(await t.draft()).toMatchObject({ status: "in_review", approvedVersion: null });
    expect(await t.approveDraft(2)).toMatchObject({ ok: true });
    expect(await t.draft()).toMatchObject({ status: "approved", approvedVersion: 2 });
    const reviews = t.raw.prepare("SELECT version FROM draft_reviews").all();
    expect(reviews).toEqual([{ version: 2 }]);
  });

  it("F3: refuses the approve when a version is saved between the read and the write", async () => {
    const t = setup("x_post");
    await t.save(1);
    const seen = await t.draft();
    await t.save(2);
    const result = await reviewDraft(t.db, accessFor(LEAD, true), seen, "approve", 1, null);
    expect(result.ok).toBe(false);
    expect(await t.draft()).toMatchObject({ status: "in_review", approvedVersion: null });
  });

  it("clears the approval when a new version is saved", async () => {
    const t = await approvedWithTarget("x_post");
    await t.save(2);
    expect(await t.draft()).toMatchObject({ status: "in_review", approvedVersion: null });
  });
});

describe("a post goes out only as the version both approvals name", () => {
  it("sends exactly the approved version", async () => {
    const t = await approvedWithTarget("x_post");
    const result = await t.approveAsCohost(1);
    expect(result).toMatchObject({ ok: true });
    expect(t.posts).toEqual(["post v1"]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({
      status: "scheduled",
      approvedVersion: 1,
    });
  });

  it("F1: sends nothing when a version is saved between the target approval and the send", async () => {
    const t = await approvedWithTarget("x_post");
    t.after("SET status = 'approved', approved_version", async () => {
      await t.save(2);
    });
    const result = await t.approveAsCohost(1);
    expect(result.ok).toBe(false);
    expect(t.posts).toEqual([]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({
      status: "approved",
      approvedVersion: 1,
    });
  });

  it("F1: a version saved after the claim does not change what is sent", async () => {
    const t = await approvedWithTarget("x_post");
    t.after("SET status = 'dispatching'", async () => {
      await t.save(2);
    });
    await t.approveAsCohost(1);
    expect(t.posts).toEqual(["post v1"]);
  });

  it("F4: refuses a target approval pressed on an older version", async () => {
    const t = await approvedWithTarget("x_post");
    await t.save(2);
    expect(await t.approveDraft(2)).toMatchObject({ ok: true });
    const result = await t.approveAsCohost(1);
    expect(result.ok).toBe(false);
    expect(t.posts).toEqual([]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({ status: "pending" });
    expect(await t.approveAsCohost(2)).toMatchObject({ ok: true });
    expect(t.posts).toEqual(["post v2"]);
  });

  it("refuses a target approval while the latest version is not approved", async () => {
    const t = await approvedWithTarget("x_post");
    await t.save(2);
    const result = await t.approveAsCohost(2);
    expect(result.ok).toBe(false);
    expect(t.posts).toEqual([]);
  });
});

describe("the mail cron sends only the version both approvals name", () => {
  it("sends the approved mail once", async () => {
    const t = await approvedWithTarget("connpass_mail");
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    expect(await sendDueMails(t.env)).toEqual({ sent: 1, failed: 0 });
    expect(await sendDueMails(t.env)).toEqual({ sent: 0, failed: 0 });
    expect(t.mails).toEqual(["subject v1|body v1"]);
  });

  it("F2: a chapter's approval of version 1 does not send version 2", async () => {
    const t = await approvedWithTarget("connpass_mail");
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    await t.save(2);
    expect(await t.approveDraft(2)).toMatchObject({ ok: true });
    expect(await dueMailTargets(t.db, 1)).toEqual([]);
    expect(await sendDueMails(t.env)).toEqual({ sent: 0, failed: 0 });
    expect(t.mails).toEqual([]);
    expect(await t.approveAsCohost(2)).toMatchObject({ ok: true });
    expect(await sendDueMails(t.env)).toEqual({ sent: 1, failed: 0 });
    expect(t.mails).toEqual(["subject v2|body v2"]);
  });

  it("F1: a version saved between the cron's read and its claim is not sent", async () => {
    const t = await approvedWithTarget("connpass_mail");
    await t.approveAsCohost(1);
    t.after("JOIN drafts d ON d.schedule_item_id = i.id", async () => {
      await t.save(2);
    });
    expect(await sendDueMails(t.env)).toEqual({ sent: 0, failed: 0 });
    expect(t.mails).toEqual([]);
  });
});

const destination = (n: number) => `https://example.com/v${n}`;

const linked: Content = (n) => ({
  posts: [
    {
      text: `post v${n} {{shortlink}}`,
      attachment: { kind: "none", link: { url: destination(n) } },
    },
  ],
});

const sentLinks = (t: ReturnType<typeof setup>, texts: string[]) =>
  texts.map((text) => {
    const slug = /https:\/\/gdgs\.jp\/(\S+)/.exec(text)?.[1] ?? "";
    return t.tinyurl.links.get(slug)?.destinationUrl ?? null;
  });

const nothingWritten = (t: ReturnType<typeof setup>) => ({
  tinyurl: t.tinyurl.calls,
  links: t.raw.prepare("SELECT id FROM campaign_links").all(),
  log: t.raw.prepare("SELECT action FROM dispatch_log").all(),
  reviews: t.raw.prepare("SELECT id FROM draft_reviews").all(),
  targets: t.raw.prepare("SELECT id FROM dispatch_targets").all(),
});

const untouched = { tinyurl: [], links: [], log: [], reviews: [], targets: [] };

describe("a short link is created only for an approved version", () => {
  it("a refused approval of version 1 leaves nothing, and version 2 goes out with its own link", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    await t.save(2);
    expect(await t.press(LEAD, true, 1)).toEqual({ ok: false, errors: [STALE_VERSION] });
    expect(nothingWritten(t)).toEqual(untouched);
    expect(await t.draft()).toMatchObject({ status: "in_review", approvedVersion: null });

    expect(await t.press(LEAD, true, 2)).toMatchObject({ ok: true });
    expect(await t.approveAsCohost(2)).toMatchObject({ ok: true });
    expect(t.posts).toHaveLength(1);
    expect(sentLinks(t, t.posts)).toEqual([destination(2)]);
    expect(t.tinyurl.calls.map((c) => c.destinationUrl)).toEqual([destination(2)]);
  });

  it("an approval refused for permission leaves nothing", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    const result = await t.press(COHOST, false, 1);
    expect(result.ok).toBe(false);
    expect(nothingWritten(t)).toEqual(untouched);
    expect(await t.draft()).toMatchObject({ status: "in_review", approvedVersion: null });
  });

  it("never reuses the link of an earlier approved version", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    expect(await t.press(LEAD, true, 1)).toMatchObject({ ok: true });
    await t.save(2);
    expect(await t.press(LEAD, true, 2)).toMatchObject({ ok: true });
    expect(await t.approveAsCohost(2)).toMatchObject({ ok: true });
    expect(sentLinks(t, t.posts)).toEqual([destination(2)]);
    expect(
      t.raw
        .prepare("SELECT draft_id, draft_version, destination_url FROM campaign_links ORDER BY id")
        .all(),
    ).toEqual([
      { draft_id: 1, draft_version: 1, destination_url: destination(1) },
      { draft_id: 1, draft_version: 2, destination_url: destination(2) },
    ]);
  });

  it("keeps the approval when tinyurl is down and creates the link once on the send", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    t.tinyurl.down = true;
    const approved = await t.press(LEAD, true, 1);
    expect(approved.ok).toBe(false);
    expect(await t.draft()).toMatchObject({ status: "approved", approvedVersion: 1 });
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);

    expect(await t.approveAsCohost(1)).toMatchObject({ ok: false });
    expect(t.posts).toEqual([]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({ status: "failed" });

    t.tinyurl.down = false;
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    expect(sentLinks(t, t.posts)).toEqual([destination(1)]);
    expect(t.tinyurl.links.size).toBe(1);
    expect(t.raw.prepare("SELECT draft_version FROM campaign_links").all()).toEqual([
      { draft_version: 1 },
    ]);
  });

  it("a retry after tinyurl kept a link pr did not record adopts that link and sends once", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    t.tinyurl.down = true;
    expect((await t.press(LEAD, true, 1)).ok).toBe(false);
    t.tinyurl.down = false;
    t.after("INSERT INTO campaign_links", async () => {
      t.raw.exec("DELETE FROM campaign_links");
    });
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: false });
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);
    expect(t.posts).toEqual([]);
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    expect(t.posts).toHaveLength(1);
    expect(sentLinks(t, t.posts)).toEqual([destination(1)]);
    expect(t.tinyurl.links.size).toBe(1);
    expect(
      t.raw.prepare("SELECT slug, draft_version, destination_url FROM campaign_links").all(),
    ).toEqual([{ slug: "devfest-x-1v1", draft_version: 1, destination_url: destination(1) }]);
  });

  it("a second approver adopts the link whose record the draft approver's create lost, and sends it once", async () => {
    const t = setup("x_post", linked);
    t.raw.exec(`INSERT INTO campaign_accounts (id, campaign_id, kind, chapter_id, external_id,
      label, role) VALUES (2, 1, 'x', 1, 'x-1', 'host-account', 'primary')`);
    await t.save(1);
    t.after("INSERT INTO campaign_links", async () => {
      t.raw.exec("DELETE FROM campaign_links");
    });
    expect((await t.press(LEAD, true, 1)).ok).toBe(false);
    expect(t.tinyurl.links.size).toBe(1);
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);
    const host = (await listTargets(t.db, 1)).find((target) => target.account.id === 2);
    expect(
      await approveTarget(t.env, accessFor(HOST_MEMBER, false), await t.draft(), host?.id ?? 0, 1),
    ).toMatchObject({ ok: true });
    expect(t.posts).toHaveLength(1);
    expect(sentLinks(t, t.posts)).toEqual([destination(1)]);
    expect(t.tinyurl.links.size).toBe(1);
    expect(
      t.raw.prepare("SELECT slug, draft_version, destination_url FROM campaign_links").all(),
    ).toEqual([{ slug: "devfest-x-1v1", draft_version: 1, destination_url: destination(1) }]);
  });

  it.each([
    ["a taken slug with no origin", null],
    ["a link for this origin with another destination", "pr:1:1:1"],
  ])("refuses %s, and sends nothing", async (_, origin) => {
    const t = setup("x_post", linked);
    t.tinyurl.links.set("devfest-x-1v1", {
      destinationUrl: "https://elsewhere.example/",
      ownerUserId: "lead",
      ownerChapterId: null,
      campaignChannelId: null,
      origin,
      originChapterId: origin ? 1 : null,
    });
    await t.save(1);
    expect((await t.press(LEAD, true, 1)).ok).toBe(false);
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: false });
    expect(t.posts).toEqual([]);
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({ status: "failed" });
  });

  it("stops the send when tinyurl does not know the origin yet and the slug is taken", async () => {
    const t = setup("x_post", linked);
    t.tinyurl.originAware = false;
    await t.save(1);
    t.after("INSERT INTO campaign_links", async () => {
      t.raw.exec("DELETE FROM campaign_links");
    });
    expect((await t.press(LEAD, true, 1)).ok).toBe(false);
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: false });
    expect(t.posts).toEqual([]);
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);
    expect(t.tinyurl.links.size).toBe(1);
  });

  it("a co-host chapter's target approver adopts the host's link whose record was lost, and sends it once", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    t.after("INSERT INTO campaign_links", async () => {
      t.raw.exec("DELETE FROM campaign_links");
    });
    expect((await t.press(LEAD, true, 1)).ok).toBe(false);
    expect(t.tinyurl.links.size).toBe(1);
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    expect(t.posts).toHaveLength(1);
    expect(sentLinks(t, t.posts)).toEqual([destination(1)]);
    expect(t.tinyurl.links.size).toBe(1);
    expect([...t.tinyurl.links.values()][0]).toMatchObject({ ownerUserId: "lead" });
    expect(
      t.raw.prepare("SELECT slug, draft_version, destination_url FROM campaign_links").all(),
    ).toEqual([{ slug: "devfest-x-1v1", draft_version: 1, destination_url: destination(1) }]);
    expect(
      t.raw.prepare("SELECT detail FROM dispatch_log WHERE action = 'link_adopt'").all(),
    ).toEqual([{ detail: "v1 https://gdgs.jp/devfest-x-1v1 by cohost" }]);
  });

  it("an approver without authority for the target makes no url.gdgs.jp call", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    t.tinyurl.down = true;
    await t.press(LEAD, true, 1);
    t.tinyurl.down = false;
    const calls = t.tinyurl.calls.length;
    const stranger = user("stranger", 3, "organizer");
    const result = await approveTarget(t.env, accessFor(stranger, true), await t.draft(), 1, 1);
    expect(result.ok).toBe(false);
    expect(t.tinyurl.calls).toHaveLength(calls);
    expect(t.posts).toEqual([]);
  });

  it("never delivers a stored link whose destination is not the version's link URL", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    t.raw.exec(`INSERT INTO campaign_links (campaign_id, draft_id, draft_version, tinyurl_link_id,
      short_url, slug, destination_url)
      VALUES (1, 1, 1, 'old', 'https://gdgs.jp/old', 'old', 'https://wrong.example/')`);
    t.tinyurl.links.set("old", {
      destinationUrl: "https://wrong.example/",
      ownerUserId: "lead",
      ownerChapterId: 1,
      campaignChannelId: null,
    });
    expect(await t.press(LEAD, true, 1)).toMatchObject({ ok: true });
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    expect(sentLinks(t, t.posts)).toEqual([destination(1)]);
    expect(
      t.raw.prepare("SELECT slug, draft_id, draft_version FROM campaign_links ORDER BY id").all(),
    ).toEqual([
      { slug: "old", draft_id: null, draft_version: null },
      { slug: "devfest-x-1v1", draft_id: 1, draft_version: 1 },
    ]);
  });

  it("the mail cron creates the missing link for the approved version before it sends", async () => {
    const t = setup("connpass_mail", (n) => ({
      subject: `subject v${n}`,
      text: `body v${n} {{shortlink}}`,
    }));
    t.raw.exec(`INSERT INTO briefs (campaign_id, version, body, author)
      VALUES (1, 1, '{"event":{"connpassUrl":"https://connpass.example/e"}}', 'lead')`);
    await t.save(1);
    t.tinyurl.down = true;
    await t.press(LEAD, true, 1);
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    t.tinyurl.down = false;
    expect(await sendDueMails(t.env)).toEqual({ sent: 1, failed: 0 });
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0]).not.toContain("{{shortlink}}");
    expect(sentLinks(t, t.mails)).toEqual(["https://connpass.example/e"]);
  });
});

describe("a hand-off after approval sends the approved version", () => {
  it("publishes the approved connpass page even when a version is saved right after", async () => {
    const t = setup("x_post", (n) => ({ title: `page v${n}`, html: `<p>v${n}</p>` }));
    t.raw.exec("UPDATE drafts SET kind = 'connpass_page', schedule_item_id = NULL");
    await t.save(1);
    t.after("UPDATE drafts SET status = ?", async () => {
      await t.save(2);
    });
    expect(await t.press(LEAD, true, 1)).toMatchObject({ ok: true });
    expect(t.pages).toEqual(["<p>v1</p>"]);
  });
});

describe("migration 0012", () => {
  it("leaves an old link unbound, so the unsent target goes out with version 2's own link", async () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const files = readdirSync(directory).sort();
    const raw = sqlite("");
    for (const file of files.filter((f) => f < "0012"))
      raw.exec(readFileSync(new URL(file, directory), "utf8"));
    const version = (n: number) => JSON.stringify(linked(n)).replaceAll("'", "''");
    raw.exec(`
      INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by,
        tinyurl_campaign_id)
        VALUES (1, 1, 'c1', 'devfest', 'DevFest', 'v1', 'lead', 7);
      INSERT INTO schedule_items (id, campaign_id, kind, due_at, title, status)
        VALUES (1, 1, 'x_post', 0, 'item', 'dispatching');
      INSERT INTO drafts (id, campaign_id, kind, schedule_item_id, title, status, current_version,
        approved_by, approved_version)
        VALUES (1, 1, 'x_post', 1, 'draft', 'approved', 2, 'lead', 2);
      INSERT INTO draft_versions (draft_id, version, author, content, playbook_version, check_results)
        VALUES (1, 1, 'agent', '${version(1)}', 'v1', '[]'),
               (1, 2, 'agent', '${version(2)}', 'v1', '[]');
      INSERT INTO campaign_accounts (id, campaign_id, kind, chapter_id, external_id, label, role)
        VALUES (1, 1, 'x', 2, 'x-2', 'sent-account', 'mirror'),
               (2, 1, 'x', 2, 'x-3', 'unsent-account', 'mirror');
      INSERT INTO dispatch_targets (id, schedule_item_id, account_id, status, approved_version,
        approved_by, actor_snapshot)
        VALUES (1, 1, 1, 'scheduled', 2, 'cohost', '{}'), (2, 1, 2, 'pending', NULL, NULL, NULL);
      INSERT INTO campaign_links (campaign_id, schedule_item_id, tinyurl_link_id, short_url, slug,
        destination_url)
        VALUES (1, 1, 'legacy', 'https://gdgs.jp/devfest-x-1', 'devfest-x-1', '${destination(1)}');
    `);
    raw.exec(
      readFileSync(new URL(files.find((f) => f.startsWith("0012")) ?? "", directory), "utf8"),
    );
    expect(raw.prepare("SELECT slug, draft_id, draft_version FROM campaign_links").all()).toEqual([
      { slug: "devfest-x-1", draft_id: null, draft_version: null },
    ]);
    const t = setup("x_post", linked, raw);
    t.tinyurl.links.set("devfest-x-1", {
      destinationUrl: destination(1),
      ownerUserId: "lead",
      ownerChapterId: 1,
      campaignChannelId: null,
    });
    expect(await t.approveAsCohost(2, 2)).toMatchObject({ ok: true });
    expect(t.posts).toHaveLength(1);
    expect(sentLinks(t, t.posts)).toEqual([destination(2)]);
  });
});

describe("migration 0011", () => {
  it("makes approvals stored without a version approve again", () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const files = readdirSync(directory).sort();
    const raw = sqlite("");
    for (const file of files.filter((f) => f < "0011"))
      raw.exec(readFileSync(new URL(file, directory), "utf8"));
    raw.exec(`
      INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by)
        VALUES (1, 1, 'c1', 'devfest', 'DevFest', 'v1', 'lead');
      INSERT INTO schedule_items (id, campaign_id, kind, due_at, title, status)
        VALUES (1, 1, 'connpass_mail', 0, 'waiting', 'approved'),
               (2, 1, 'x_post', 0, 'sent', 'scheduled');
      INSERT INTO drafts (id, campaign_id, kind, schedule_item_id, title, status, current_version,
        approved_by)
        VALUES (1, 1, 'connpass_mail', 1, 'waiting', 'approved', 1, 'lead'),
               (2, 1, 'x_post', 2, 'sent', 'approved', 1, 'lead');
      INSERT INTO campaign_accounts (id, campaign_id, kind, chapter_id, external_id, label)
        VALUES (1, 1, 'connpass_group', 1, 'g', 'g'), (2, 1, 'x', 1, 'x', 'x');
      INSERT INTO dispatch_targets (schedule_item_id, account_id, status, approved_by, actor_snapshot)
        VALUES (1, 1, 'approved', 'lead', '{}'), (2, 2, 'scheduled', 'lead', '{}');
    `);
    raw.exec(
      readFileSync(new URL(files.find((f) => f.startsWith("0011")) ?? "", directory), "utf8"),
    );
    expect(
      raw.prepare("SELECT id, status, approved_version FROM drafts ORDER BY id").all(),
    ).toEqual([
      { id: 1, status: "needs_approval", approved_version: null },
      { id: 2, status: "approved", approved_version: null },
    ]);
    expect(
      raw
        .prepare("SELECT status, approved_by, approved_version FROM dispatch_targets ORDER BY id")
        .all(),
    ).toEqual([
      { status: "pending", approved_by: null, approved_version: null },
      { status: "scheduled", approved_by: "lead", approved_version: null },
    ]);
    expect(raw.prepare("SELECT status FROM schedule_items ORDER BY id").all()).toEqual([
      { status: "needs_approval" },
      { status: "scheduled" },
    ]);
  });
});

describe("the attached image is part of a version", () => {
  it("changing the image of an approved post needs a new approval, which sends the new image", async () => {
    serveImages();
    const t = setup("x_post");
    await t.save(1);
    expect(await t.setMedia("https://img.example/a.png")).toMatchObject({ ok: true });
    const withA = (await t.draft()).currentVersion;
    expect(await t.approveDraft(withA)).toMatchObject({ ok: true });
    await ensureTargets(t.db, 1, 1, "x");

    expect(await t.setMedia("https://img.example/b.png")).toMatchObject({ ok: true });
    const withB = await t.draft();
    expect(withB).toMatchObject({ status: "in_review", approvedVersion: null });
    expect(withB.currentVersion).toBeGreaterThan(withA);
    expect((await t.approveAsCohost(withA)).ok).toBe(false);
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual([]);

    expect(await t.approveDraft(withB.currentVersion)).toMatchObject({ ok: true });
    expect(await t.approveAsCohost(withB.currentVersion)).toMatchObject({ ok: true });
    expect(t.posts).toEqual(["post v1"]);
    expect(t.media).toEqual(["sns-1 https://img.example/b.png"]);
  });

  it("keeps the image on later versions and saves no version when it does not change", async () => {
    const t = setup("x_post");
    await t.save(1);
    await t.setMedia("https://img.example/a.png");
    const withA = (await t.draft()).currentVersion;
    expect(await t.setMedia("https://img.example/a.png")).toMatchObject({ ok: true });
    expect((await t.draft()).currentVersion).toBe(withA);
    await t.save(2);
    expect(await latestVersion(t.db, 1)).toMatchObject({
      content: { posts: [{ text: "post v2" }] },
      mediaUrl: "https://img.example/a.png",
    });
  });
});

describe("the minute cron sends an approved post the Worker did not claim", () => {
  it("sends it once, as the approved version and the approver", async () => {
    const t = await approvedButUnclaimed();
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual(["post v1"]);
    expect(t.actors).toEqual(["cohost"]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({
      status: "scheduled",
      approvedVersion: 1,
      externalRef: { snsPostId: "sns-1" },
    });
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual(["post v1"]);
  });

  it("two crons claiming at once send it once", async () => {
    const t = await approvedButUnclaimed();
    t.after("a.kind = 'x'", async () => {
      await runCron(t.env, MINUTE_CRON);
    });
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual(["post v1"]);
  });

  it("creates the approved version's missing short link before the cron sends it", async () => {
    const t = setup("x_post", linked);
    await t.save(1);
    t.tinyurl.down = true;
    await t.press(LEAD, true, 1);
    expect(await t.draft()).toMatchObject({ status: "approved", approvedVersion: 1 });
    expect(t.raw.prepare("SELECT id FROM campaign_links").all()).toEqual([]);
    t.after("SET status = 'approved', approved_version", async () => {
      throw new Error("worker stopped");
    });
    await expect(t.approveAsCohost(1)).rejects.toThrow("worker stopped");
    t.tinyurl.down = false;

    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]).not.toContain("{{shortlink}}");
    expect(sentLinks(t, t.posts)).toEqual([destination(1)]);
    expect(t.raw.prepare("SELECT draft_id, draft_version FROM campaign_links").all()).toEqual([
      { draft_id: 1, draft_version: 1 },
    ]);
  });

  it("a cron during the approval request does not send twice", async () => {
    const t = await approvedWithTarget("x_post");
    t.after("SET status = 'approved', approved_version", async () => {
      await runCron(t.env, MINUTE_CRON);
    });
    expect(await t.approveAsCohost(1)).toMatchObject({ ok: true });
    expect(t.posts).toEqual(["post v1"]);
  });

  it("does not send an approval whose version is no longer the latest", async () => {
    const t = await approvedButUnclaimed();
    await t.save(2);
    await runCron(t.env, MINUTE_CRON);
    expect(await t.approveDraft(2)).toMatchObject({ ok: true });
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual([]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({
      status: "approved",
      approvedVersion: 1,
    });
  });
});

describe("migration 0013", () => {
  it("moves a draft's image to its current version", () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const files = readdirSync(directory).sort();
    const raw = sqlite("");
    for (const file of files.filter((f) => f < "0013"))
      raw.exec(readFileSync(new URL(file, directory), "utf8"));
    raw.exec(`
      INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by)
        VALUES (1, 1, 'c1', 'devfest', 'DevFest', 'v1', 'lead');
      INSERT INTO drafts (id, campaign_id, kind, title, status, current_version, approved_version,
        dispatch_media_url)
        VALUES (1, 1, 'x_post', 'with image', 'approved', 2, 2, 'https://img.example/a.png'),
               (2, 1, 'x_post', 'without image', 'in_review', 1, NULL, NULL);
      INSERT INTO draft_versions (draft_id, version, author, content, playbook_version)
        VALUES (1, 1, 'agent', '{}', 'v1'), (1, 2, 'human', '{}', 'v1'), (2, 1, 'agent', '{}', 'v1');
    `);
    raw.exec(
      readFileSync(new URL(files.find((f) => f.startsWith("0013")) ?? "", directory), "utf8"),
    );
    expect(
      raw.prepare("SELECT draft_id, version, media_url FROM draft_versions ORDER BY id").all(),
    ).toEqual([
      { draft_id: 1, version: 1, media_url: null },
      { draft_id: 1, version: 2, media_url: "https://img.example/a.png" },
      { draft_id: 2, version: 1, media_url: null },
    ]);
    expect(raw.prepare("SELECT status, approved_version FROM drafts WHERE id = 1").get()).toEqual({
      status: "approved",
      approved_version: 2,
    });
  });
});
