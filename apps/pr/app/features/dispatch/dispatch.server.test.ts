import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignAccess } from "~/features/campaigns/access.server";
import { sendDueMails } from "~/features/connpass/mail.server";
import { MINUTE_CRON, runCron } from "~/features/cron/cron.server";
import {
  appendVersion,
  getDraftById,
  latestVersion,
} from "~/features/drafts/draft.repository.server";
import { reviewDraft } from "~/features/drafts/review.server";
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
    campaign: { id: 1, slug: "devfest", chapterId: 1 },
    campaignChapters: [],
    members: [
      { userId: "lead", roles: ["lead"] },
      { userId: "cohost", roles: [] },
    ],
    permissions: { manage, edit: true },
  } as unknown as CampaignAccess;
}

const LEAD = user("lead", 1, "organizer");
const COHOST = user("cohost", 2, "member");

function setup(kind: "x_post" | "connpass_mail") {
  const raw = sqlite(schema());
  raw.exec(`
    INSERT INTO campaigns (id, chapter_id, chapter_slug, slug, name, playbook_version, created_by,
      connpass_group_slug, connpass_event_id)
      VALUES (1, 1, 'c1', 'devfest', 'DevFest', 'v1', 'lead', 'group-2', '99');
    INSERT INTO schedule_items (id, campaign_id, kind, due_at, title, status)
      VALUES (1, 1, '${kind}', 0, 'item', 'in_review');
    INSERT INTO drafts (id, campaign_id, kind, schedule_item_id, title, status)
      VALUES (1, 1, '${kind}', 1, 'draft', 'generating');
    INSERT INTO campaign_accounts (id, campaign_id, kind, chapter_id, external_id, label, role)
      VALUES (1, 1, '${kind === "x_post" ? "x" : "connpass_group"}', 2,
        '${kind === "x_post" ? "x-2" : "group-2"}', 'cohost-account', 'mirror');
  `);
  const { db, after } = d1(raw);
  const posts: string[] = [];
  const actors: string[] = [];
  const media: string[] = [];
  const mails: string[] = [];
  const env = {
    DB: db,
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
      content:
        kind === "x_post"
          ? { posts: [{ text: `post v${n}` }] }
          : { subject: `subject v${n}`, text: `body v${n}` },
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
  const approveAsCohost = async (version: number) =>
    approveTarget(env, accessFor(COHOST, false), await draft(), 1, version);
  const setMedia = async (url: string) => {
    const form = new FormData();
    form.set("mediaUrl", url);
    return deliveryAction(env, accessFor(LEAD, true), await draft(), "media", form);
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
    save,
    draft,
    approveDraft,
    approveAsCohost,
    setMedia,
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
  expect(await t.approveDraft(1)).toEqual({ ok: true });
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
    expect(await t.approveDraft(2)).toEqual({ ok: true });
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
    expect(await t.approveDraft(2)).toEqual({ ok: true });
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
    expect(await t.approveDraft(2)).toEqual({ ok: true });
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

describe("the attached image is part of a version", () => {
  it("changing the image of an approved post needs a new approval, which sends the new image", async () => {
    serveImages();
    const t = setup("x_post");
    await t.save(1);
    expect(await t.setMedia("https://img.example/a.png")).toMatchObject({ ok: true });
    const withA = (await t.draft()).currentVersion;
    expect(await t.approveDraft(withA)).toEqual({ ok: true });
    await ensureTargets(t.db, 1, 1, "x");

    expect(await t.setMedia("https://img.example/b.png")).toMatchObject({ ok: true });
    const withB = await t.draft();
    expect(withB).toMatchObject({ status: "in_review", approvedVersion: null });
    expect(withB.currentVersion).toBeGreaterThan(withA);
    expect((await t.approveAsCohost(withA)).ok).toBe(false);
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual([]);

    expect(await t.approveDraft(withB.currentVersion)).toEqual({ ok: true });
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
    expect(await t.approveDraft(2)).toEqual({ ok: true });
    await runCron(t.env, MINUTE_CRON);
    expect(t.posts).toEqual([]);
    expect((await listTargets(t.db, 1))[0]).toMatchObject({
      status: "approved",
      approvedVersion: 1,
    });
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

describe("migration 0012", () => {
  it("moves a draft's image to its current version", () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const files = readdirSync(directory).sort();
    const raw = sqlite("");
    for (const file of files.filter((f) => f < "0012"))
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
      readFileSync(new URL(files.find((f) => f.startsWith("0012")) ?? "", directory), "utf8"),
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
