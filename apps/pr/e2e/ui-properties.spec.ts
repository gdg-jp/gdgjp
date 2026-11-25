import {
  PropertyViolation,
  type UiProperty,
  action,
  checkUiProperty,
  invariant,
  runPlan,
} from "@gdgjp/ui-properties";
import { type Browser, type Page, expect, test } from "@playwright/test";
import {
  ACTORS,
  ACTOR_NAMES,
  type ActorName,
  CHAPTERS,
  type Chapter,
  type Model,
  type PrWorld,
  SHORTLINK,
  type Send,
  connpassJobCount,
  createWorld,
  current,
  linkOf,
  linkRows,
  linkUrl,
  mockState,
  outside,
  ownLinks,
  postContent,
  textOf,
} from "./ui-properties-world";

test.describe.configure({ retries: 0 });

const PR_ORIGIN = `http://localhost:${process.env.PR_E2E_PERSIST_TO || process.env.CI ? 6191 : 5191}`;
const EDIT_WORDS = ["告知", "update", "テスト 🎉", "改行\nあり", "  前後に空白  ", "最終版"];

const observed = { sends: 0, targetApprovals: 0, draftApprovals: 0, linkEdits: 0, refusals: 0 };
const SHORT_URL = /https:\/\/gdgs\.jp\/[A-Za-z0-9-]+/g;

type Target = { actor: ActorName; chapter: Chapter };
type Approval = { actor: ActorName; version: "current" | "stale" };
type TargetPost = Target & { version: "current" | "stale" };

const canApproveTarget = (actor: ActorName, chapter: Chapter) =>
  (ACTORS[actor].organizerOf as readonly number[]).includes(chapter);
const inCampaign = (actor: ActorName) => actor !== "outsider";

function predictDraftApproval(model: Model, actor: ActorName, version: number) {
  if (!ACTORS[actor].manage || version !== current(model) || model.status === "approved")
    return false;
  observed.draftApprovals++;
  model.status = "approved";
  model.approvedVersion = version;
  model.approvedVersions.push(version);
  model.targets ??= {
    1: { status: "pending", approvedVersion: null },
    2: { status: "pending", approvedVersion: null },
  };
  return true;
}

function predictTargetApproval(model: Model, actor: ActorName, chapter: Chapter, version: number) {
  const target = model.targets?.[chapter];
  if (!target || !inCampaign(actor) || !canApproveTarget(actor, chapter)) return false;
  if (model.status !== "approved" || model.approvedVersion !== current(model)) return false;
  if (version !== current(model)) return false;
  const open =
    target.status === "pending" ||
    (target.status === "approved" && target.approvedVersion !== version);
  if (!open) return false;
  target.status = "scheduled";
  target.approvedVersion = version;
  observed.targetApprovals++;
  model.sends.push({
    chapterId: chapter,
    text: textOf(model, version),
    actor: `dev-user-${actor}`,
    version,
  });
  return true;
}

function versionFor(model: Model, choice: "current" | "stale") {
  return choice === "stale" && current(model) > 1 ? current(model) - 1 : current(model);
}

async function openDraft(world: PrWorld, actor: ActorName) {
  const response = await world.pages[actor].goto(world.draftUrl);
  const status = response?.status() ?? 0;
  if (inCampaign(actor)) expect(status, `${actor} opens the draft`).toBe(200);
  else expect(status, `${actor} must not see the draft`).toBe(404);
  world.model.seen[actor] = inCampaign(actor) ? current(world.model) : null;
}

async function postForm(world: PrWorld, actor: ActorName, form: Record<string, string>) {
  const response = await world.pages[actor].request.post(world.draftUrl, { form });
  expect(response.status(), `${form.intent} by ${actor}`).toBeLessThan(500);
  return response;
}

const reserveButton = (page: Page, chapter: Chapter) =>
  page
    .getByRole("list", { name: "配信先" })
    .getByRole("listitem")
    .filter({ hasText: `@chapter${chapter}` })
    .getByRole("button", { name: `@chapter${chapter} で予約` });

async function submitted(world: PrWorld, page: Page, click: () => Promise<void>) {
  const response = page.waitForResponse(
    (item) => item.request().method() === "POST" && item.url().includes(world.draftUrl),
  );
  await click();
  await response;
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

async function watchRefusal(world: PrWorld, action: string, accepted: boolean) {
  world.refusal = accepted ? null : { action, before: await outside(world) };
  if (!accepted) observed.refusals++;
}

const onDraft = (world: PrWorld, actor: ActorName) =>
  world.model.seen[actor] !== null && world.pages[actor].url().endsWith(world.draftUrl);

const property = (browser: Browser): UiProperty<PrWorld> => ({
  name: "pr sends only the approved version",
  setup: createWorld(browser),
  teardown: (world) => world.close(),
  actions: [
    action<PrWorld, { actor: ActorName }>({
      name: "open the draft",
      weight: 3,
      input: (random) => ({ actor: random.pick(ACTOR_NAMES) }),
      run: (world, input) => openDraft(world, input.actor),
    }),
    action<PrWorld, { actor: ActorName; word: string }>({
      name: "edit the post text",
      weight: 3,
      enabled: (world) =>
        ACTOR_NAMES.some((actor) => actor !== "outsider" && onDraft(world, actor)),
      input: (random, world) => ({
        actor: random.pick(
          ACTOR_NAMES.filter((actor) => actor !== "outsider" && onDraft(world, actor)),
        ),
        word: random.pick(EDIT_WORDS),
      }),
      run: async (world, input) => {
        const page = world.pages[input.actor];
        const model = world.model;
        model.edits++;
        const text = `${world.marker} e${model.edits} ${input.word} ${SHORTLINK}`;
        await world.ui.fill(page.getByLabel("投稿の本文"), text);
        await world.ui.click(page.getByRole("button", { name: "新しい版として保存" }));
        model.versions.push(text.replace(/\r\n/g, "\n"));
        model.links.push(linkOf(model, current(model) - 1));
        if (model.status === "approved") model.status = "in_review";
        await expect(page.getByText(`版 ${current(model)} を保存しました`)).toBeVisible();
        model.seen[input.actor] = current(model);
      },
    }),
    action<PrWorld, { actor: ActorName }>({
      name: "save a new version with a different link",
      weight: 2,
      input: (random) => ({
        actor: random.pick(ACTOR_NAMES.filter((actor) => actor !== "outsider")),
      }),
      run: async (world, input) => {
        const model = world.model;
        model.edits++;
        const text = `${world.marker} l${model.edits} リンクを差し替え ${SHORTLINK}`;
        const url = linkUrl(world.marker, model.edits);
        const response = await postForm(world, input.actor, {
          intent: "edit-json",
          json: JSON.stringify(postContent(text, url)),
        });
        expect(response.status(), "saving a new link").toBe(200);
        model.versions.push(text);
        model.links.push(url);
        observed.linkEdits++;
        if (model.status === "approved") model.status = "in_review";
      },
    }),
    action<PrWorld, { actor: ActorName }>({
      name: "approve the draft in the page",
      weight: 3,
      enabled: async (world) =>
        onDraft(world, "lead") &&
        world.model.status !== "approved" &&
        (await world.pages.lead.getByRole("button", { name: "承認", exact: true }).count()) > 0,
      input: () => ({ actor: "lead" }),
      run: async (world, input) => {
        const page = world.pages[input.actor];
        const approve = page.getByRole("button", { name: "承認", exact: true });
        if ((await approve.count()) === 0) return;
        const seen = world.model.seen[input.actor] ?? 0;
        const expected = predictDraftApproval(world.model, input.actor, seen);
        await watchRefusal(world, "approve the draft in the page", expected);
        await submitted(world, page, () => world.ui.click(approve));
        if (expected) await targetId(world, 1);
        world.model.seen[input.actor] = current(world.model);
      },
    }),
    action<PrWorld, Approval>({
      name: "post a draft approval",
      weight: 2,
      input: (random) => ({
        actor: random.pick(ACTOR_NAMES),
        version: random.pick(["current", "stale"]),
      }),
      run: async (world, input) => {
        const version = versionFor(world.model, input.version);
        const expected = predictDraftApproval(world.model, input.actor, version);
        await watchRefusal(world, `draft approval of v${version} by ${input.actor}`, expected);
        await postForm(world, input.actor, { intent: "approve", version: String(version) });
        if (expected) await targetId(world, 1);
      },
    }),
    action<PrWorld, { actor: ActorName; chapter: Chapter }>({
      name: "reserve a target in the page",
      weight: 4,
      enabled: async (world) => {
        for (const actor of ACTOR_NAMES)
          for (const chapter of CHAPTERS)
            if (onDraft(world, actor) && (await reserveButton(world.pages[actor], chapter).count()))
              return true;
        return false;
      },
      input: async (random, world) => {
        const options: Target[] = [];
        for (const actor of ACTOR_NAMES)
          for (const chapter of CHAPTERS)
            if (onDraft(world, actor) && (await reserveButton(world.pages[actor], chapter).count()))
              options.push({ actor, chapter });
        return options.length
          ? random.pick(options)
          : { actor: random.pick(ACTOR_NAMES), chapter: random.pick(CHAPTERS) };
      },
      run: async (world, input) => {
        const page = world.pages[input.actor];
        if ((await reserveButton(page, input.chapter).count()) === 0) return;
        const seen = world.model.seen[input.actor] ?? 0;
        const expected = predictTargetApproval(world.model, input.actor, input.chapter, seen);
        await watchRefusal(world, "reserve a target in the page", expected);
        await submitted(world, page, () => world.ui.click(reserveButton(page, input.chapter)));
        world.model.seen[input.actor] = current(world.model);
      },
    }),
    action<PrWorld, TargetPost>({
      name: "post a target approval",
      weight: 3,
      enabled: (world) => world.model.targets !== null,
      input: (random) => ({
        actor: random.pick(ACTOR_NAMES),
        chapter: random.pick(CHAPTERS),
        version: random.pick(["current", "stale"]),
      }),
      run: async (world, input) => {
        const target = await targetId(world, input.chapter);
        const version = versionFor(world.model, input.version);
        const expected = predictTargetApproval(world.model, input.actor, input.chapter, version);
        await watchRefusal(
          world,
          `target approval of v${version} for chapter ${input.chapter} by ${input.actor}`,
          expected,
        );
        await postForm(world, input.actor, {
          intent: "target-approve",
          target: target,
          version: String(version),
        });
      },
    }),
    action<PrWorld, { name: "minute" | "hourly" }>({
      name: "run a cron",
      weight: 1,
      input: (random) => ({ name: random.pick(["minute", "hourly"] as const) }),
      run: async (world, input) => {
        const response = await world.request.get(`/dev/cron?name=${input.name}`);
        expect(response.status()).toBe(200);
      },
    }),
  ],
  invariants: [
    invariant(
      "every send is an approved version, once per target, by its chapter",
      async (world) => {
        const state = await mockState(world.request);
        const actual = state.sns.posts
          .filter((post) => post.text.includes(world.marker))
          .map(
            ({ chapterId, text, actor }): Send => ({
              chapterId,
              text: text.replace(SHORT_URL, SHORTLINK),
              actor,
            }),
          );
        observed.sends = Math.max(observed.sends, actual.length);
        const key = (send: Send) => JSON.stringify([send.chapterId, send.text, send.actor]);
        const expected = new Map<string, number>();
        for (const { version: _, ...send } of world.model.sends)
          expected.set(key(send), (expected.get(key(send)) ?? 0) + 1);
        for (const send of actual) {
          const left = expected.get(key(send)) ?? 0;
          if (left === 0)
            throw new PropertyViolation(
              "invariant",
              "no send without approval of that exact version",
              `sns received ${key(send)}; approved sends were ${JSON.stringify(world.model.sends)}`,
            );
          expected.set(key(send), left - 1);
        }
        const perChapter = new Map<number, number>();
        for (const send of actual)
          perChapter.set(send.chapterId, (perChapter.get(send.chapterId) ?? 0) + 1);
        for (const [chapter, count] of perChapter)
          if (count > 1)
            throw new PropertyViolation(
              "invariant",
              "at most one send per target",
              `chapter ${chapter} received ${count} posts`,
            );
        const missing = [...expected].filter(([, left]) => left > 0);
        if (missing.length)
          throw new PropertyViolation(
            "invariant",
            "an approved target is sent",
            `approved but never sent: ${missing.map(([value]) => value).join(", ")}`,
          );
        if (connpassJobCount(state) !== world.connpassJobs)
          throw new PropertyViolation(
            "invariant",
            "no send without approval of that exact version",
            "connpass received a job although no connpass draft exists",
          );
      },
    ),
    invariant("a refused approval creates no link, log row, or url.gdgs.jp call", async (world) => {
      const refusal = world.refusal;
      world.refusal = null;
      if (!refusal) return;
      const after = await outside(world);
      if (JSON.stringify(after) !== JSON.stringify(refusal.before))
        throw new PropertyViolation(
          "invariant",
          "a refused approval creates no link, log row, or url.gdgs.jp call",
          `${refusal.action} was refused but changed ${JSON.stringify(refusal.before)} to ${JSON.stringify(after)}`,
        );
    }),
    invariant("short links belong to approved versions and are sent with them", async (world) => {
      const model = world.model;
      const rows = linkRows(world);
      const state = await mockState(world.request);
      const tiny = ownLinks(world, state);
      for (const row of rows)
        if (
          row.draft_id !== null &&
          (row.draft_id !== world.draftId ||
            !model.approvedVersions.includes(row.draft_version ?? 0))
        )
          throw new PropertyViolation(
            "invariant",
            "every bound short link names an approved version",
            `campaign_links ${row.slug} is bound to draft ${row.draft_id} v${row.draft_version}; approved versions of draft ${world.draftId} are ${JSON.stringify(model.approvedVersions)}`,
          );
      const perVersion = new Map<string, number>();
      const bound = rows.filter((row) => row.draft_id !== null);
      const keys = [
        ...tiny.map((link) => {
          const row = bound.find((item) => item.tinyurl_link_id === link.id);
          return row ? `draft ${row.draft_id} v${row.draft_version}` : `unbound ${link.slug}`;
        }),
        ...bound
          .filter((row) => !tiny.some((link) => link.id === row.tinyurl_link_id))
          .map((row) => `draft ${row.draft_id} v${row.draft_version}`),
      ];
      for (const key of keys) perVersion.set(key, (perVersion.get(key) ?? 0) + 1);
      for (const [key, count] of perVersion)
        if (count > 1)
          throw new PropertyViolation(
            "invariant",
            "at most one url.gdgs.jp link per draft version",
            `${key} has ${count} links`,
          );
      const sent = state.sns.posts.filter((post) => post.text.includes(world.marker));
      for (const post of sent) {
        const normalized = post.text.replace(SHORT_URL, SHORTLINK);
        const send = model.sends.find(
          (item) => item.chapterId === post.chapterId && item.text === normalized,
        );
        const urls: string[] = post.text.match(SHORT_URL) ?? [];
        const link = tiny.find((item) => urls.includes(`https://gdgs.jp/${item.slug}`));
        const row = rows.find((item) => item.tinyurl_link_id === link?.id);
        const want = send ? linkOf(model, send.version) : "(no approved send)";
        if (
          !send ||
          urls.length !== 1 ||
          post.text.includes(SHORTLINK) ||
          link?.destinationUrl !== want ||
          row?.draft_id !== world.draftId ||
          row?.draft_version !== send.version
        )
          throw new PropertyViolation(
            "invariant",
            "each send carries the short link of the version it sends",
            `chapter ${post.chapterId} received ${JSON.stringify(post.text)} linking to ${link?.destinationUrl ?? "nothing"} (row v${row?.draft_version ?? "-"}); v${send?.version ?? "-"} links to ${want}`,
          );
      }
    }),
  ],
});

async function targetId(world: PrWorld, chapter: Chapter): Promise<string> {
  const known = world.targetIds[chapter];
  if (known) return known;
  const response = await world.pages.lead.request.get(world.draftUrl);
  for (const item of (await response.text()).split("<li")) {
    const label = /@chapter(\d)/.exec(item)?.[1];
    const id = /name="target" value="(\d+)"/.exec(item)?.[1];
    if (label && id) world.targetIds[Number(label) as Chapter] = id;
  }
  return world.targetIds[chapter] ?? "0";
}

const plan = runPlan({ seeds: [4242, 7331], steps: 80, minutes: 5 });

for (const seed of plan.seeds) {
  test(`seed ${seed} sends only approved versions`, async ({ browser }, testInfo) => {
    Object.assign(observed, {
      sends: 0,
      targetApprovals: 0,
      draftApprovals: 0,
      linkEdits: 0,
      refusals: 0,
    });
    try {
      await checkUiProperty(testInfo, property(browser), {
        plan,
        seed,
        monitor: { origins: [PR_ORIGIN] },
      });
    } finally {
      await testInfo.attach("pr-approvals.json", {
        body: JSON.stringify({ seed, predicted: observed }, null, 2),
        contentType: "application/json",
      });
      console.log(`pr property seed=${seed} predicted ${JSON.stringify(observed)}`);
    }
  });
}
