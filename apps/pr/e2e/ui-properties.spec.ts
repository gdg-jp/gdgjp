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
  type Send,
  connpassJobCount,
  createWorld,
  current,
  mockState,
  textOf,
} from "./ui-properties-world";

test.describe.configure({ retries: 0 });

const PR_ORIGIN = `http://localhost:${process.env.PR_E2E_PERSIST_TO || process.env.CI ? 6191 : 5191}`;
const EDIT_WORDS = ["告知", "update", "テスト 🎉", "改行\nあり", "  前後に空白  ", "最終版"];

const observed = { sends: 0, targetApprovals: 0, draftApprovals: 0 };

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
        const text = `${world.marker} e${model.edits} ${input.word}`;
        await world.ui.fill(page.getByLabel("投稿の本文"), text);
        await world.ui.click(page.getByRole("button", { name: "新しい版として保存" }));
        model.versions.push(text.replace(/\r\n/g, "\n"));
        if (model.status === "approved") model.status = "in_review";
        await expect(page.getByText(`版 ${current(model)} を保存しました`)).toBeVisible();
        model.seen[input.actor] = current(model);
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
        predictTargetApproval(world.model, input.actor, input.chapter, seen);
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
        predictTargetApproval(world.model, input.actor, input.chapter, version);
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
          .map(({ chapterId, text, actor }): Send => ({ chapterId, text, actor }));
        observed.sends = Math.max(observed.sends, actual.length);
        const key = (send: Send) => JSON.stringify([send.chapterId, send.text, send.actor]);
        const expected = new Map<string, number>();
        for (const send of world.model.sends)
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
    Object.assign(observed, { sends: 0, targetApprovals: 0, draftApprovals: 0 });
    try {
      await checkUiProperty(testInfo, property(browser), {
        plan,
        seed,
        monitor: { origins: [PR_ORIGIN], ignoreConsole: [/^Failed to fetch manifest patches/] },
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
