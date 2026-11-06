import { readFileSync } from "node:fs";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CAPTURE_URL } from "./capture-server";

// Delivery (Stage 03) against e2e/mock-services (sns / tinyurl) and the capture server (Discord).
const skills = new URL("../../../skills/", import.meta.url);
const brief = readFileSync(
  new URL("pr-playbook/examples/briefs/devfest-kansai-2026.json", skills),
  "utf8",
);
const xOutput = JSON.parse(
  readFileSync(new URL("pr-x-post/references/example-output.json", skills), "utf8"),
);

const runnerToken = () =>
  /^RUNNER_TOKEN="?([^"\n]+)"?/m.exec(
    readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"),
  )?.[1] ?? "";
const headers = () => ({ authorization: `Bearer ${runnerToken()}`, "x-runner-host": "e2e-runner" });

type Mocks = {
  sns: {
    calls: number;
    posts: { id: string; text: string; chapterId: number; actor: string; status: string }[];
  };
  tinyurl: {
    campaigns: [string, { id: number }][];
    channels: unknown[];
    links: { slug: string }[];
  };
};
const mocks = async (request: APIRequestContext): Promise<Mocks> =>
  (await request.get("/dev/mock-services")).json();
const messages = async (request: APIRequestContext): Promise<{ hook: string; content: string }[]> =>
  (await request.get(`${CAPTURE_URL}/messages`)).json();
const cron = async (request: APIRequestContext, name: "minute" | "hourly") =>
  expect((await request.get(`/dev/cron?name=${name}`)).status()).toBe(200);

async function signIn(page: Page, as: string, chapter: string) {
  await page.goto(`/dev/login?as=${as}&chapter=${chapter}&return_to=/`);
}

/** JST wall time `minutes` from now, for a datetime-local input. */
function jstLocal(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000 + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
}

test("an approved X post is scheduled once per account, each by its own chapter, with a short link", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const slug = `e2e-dist-${Date.now()}`;
  const hook = `kwansai-${Date.now()}`;

  // Host chapter: webhook, campaign, brief, co-host.
  await signIn(page, "lead", "1:gdg-kwansai:organizer");
  await page.goto("/settings/chapter");
  await page.getByLabel("Discord の webhook URL").fill(`${CAPTURE_URL}/hook/${hook}`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("現在: 127.0.0.1")).toBeVisible();
  await expect(page.getByText(hook)).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "キャンペーンを作成" }).first().click();
  await page.getByLabel("イベント名").fill(`E2E ${slug}`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(slug);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.getByLabel("JSON で読み込む").fill(brief);
  await page.getByRole("button", { name: "JSON を読み込む" }).click();
  await expect(page.getByText("版 1 を保存しました")).toBeVisible();
  await page.goto(`/c/${slug}/members`);
  await page.getByLabel("チャプター ID").fill("2");
  await page.getByLabel("チャプター名").fill("gdgoc-osaka");
  await page.getByRole("button", { name: "共催に追加" }).click();

  // Accounts: each chapter adds its own X account (from sns), then the host activates.
  await page.goto(`/c/${slug}/settings`);
  await page.getByRole("button", { name: "追加", exact: true }).first().click();
  await expect(page.getByText("@chapter1 を配信先に追加しました")).toBeVisible();
  await signIn(page, "osaka", "2:gdgoc-osaka:organizer");
  await page.goto(`/c/${slug}/settings`);
  await page.getByRole("button", { name: "追加", exact: true }).first().click();
  await expect(page.getByText("@chapter2 を配信先に追加しました")).toBeVisible();
  await signIn(page, "lead", "1:gdg-kwansai:organizer");
  await page.goto(`/c/${slug}/settings`);
  await expect(page.getByText("投稿できる人: lead (dev)")).toBeVisible();
  await page.getByRole("button", { name: "有効化" }).click();
  await expect(page.getByText(/有効化しました（チャネル \d+ 本）/)).toBeVisible();
  const tiny = await mocks(request);
  expect(
    tiny.tinyurl.campaigns.some(([code]) => code === slug.slice(0, 32).replace(/-+$/, "")),
  ).toBe(true);

  // An X post 30 minutes from now: its staff reminder (−60 min) is already due.
  await page.goto(`/c/${slug}/settings`);
  await page.getByLabel("スタッフへの依頼を時刻どおりに自動で Discord に送る").check();
  await page.getByRole("button", { name: "保存", exact: true }).nth(1).click();
  await page.goto(`/c/${slug}/schedule`);
  await page.getByRole("button", { name: "アイテムを追加" }).click();
  await page.getByLabel("日時").fill(jstLocal(30));
  await page.getByLabel("タイトル").fill("開催決定");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByLabel("「開催決定」の下書きを作る").check();
  await page.getByRole("button", { name: "選んだ投稿の下書きを runner に頼む" }).click();
  await expect(page.getByText(/件の下書きを runner に頼みました/)).toBeVisible();

  // The runner's post, with a link to a dead page (for the health check).
  const post = { ...xOutput.posts[0] };
  post.attachment = {
    kind: "ogp",
    imageSlots: null,
    link: { url: `${CAPTURE_URL}/dead/page`, ogImage: "https://img.gdgs.jp/og" },
  };
  const next = await request.get("/api/runner/jobs/next?types=post&wait=0", { headers: headers() });
  const job = await next.json();
  await request.post(`/api/runner/jobs/${job.id}/result`, {
    headers: headers(),
    data: {
      status: "succeeded",
      result: { output: { ...xOutput, posts: [post] }, checks: { yomiyasu: { status: "pass" } } },
    },
  });

  // Review request on Discord (minute cron), never pinging anyone.
  await cron(request, "minute");
  const afterReview = (await messages(request)).filter((m) => m.hook === hook);
  expect(afterReview.some((m) => m.content.includes("レビューをお願いします"))).toBe(true);
  // The staff reminder went out automatically.
  expect(afterReview.some((m) => m.content.includes("いいね"))).toBe(true);

  // Removing the OGP image blocks the approval (OGP-ON-SHORTLINK).
  await page.goto(`/c/${slug}/drafts`);
  await page.getByRole("link", { name: "開催決定" }).click();
  await page.waitForURL(/\/drafts\/\d+$/);
  const draftUrl = page.url();
  await page.getByLabel("OGP 画像の URL").fill("");
  await page.getByRole("button", { name: "リンクを保存" }).click();
  await expect(page.getByText(/版 2 を保存しました/)).toBeVisible();
  await page.getByRole("button", { name: "承認", exact: true }).click();
  await expect(page.getByText(/OGP-ON-SHORTLINK/)).toBeVisible();
  await page.getByLabel("OGP 画像の URL").fill("https://img.gdgs.jp/og");
  await page.getByRole("button", { name: "リンクを保存" }).click();
  await expect(page.getByText(/版 3 を保存しました/)).toBeVisible();
  await page.getByRole("button", { name: "承認", exact: true }).click();
  await expect(page.getByText("承認済み", { exact: true })).toBeVisible();
  await expect(page.getByText(/短縮リンク: https:\/\/gdgs.jp\//)).toBeVisible();

  // The host lead cannot approve the co-host's account.
  const osakaRow = page
    .getByRole("list", { name: "配信先" })
    .getByRole("listitem")
    .filter({ hasText: "@chapter2" });
  await expect(osakaRow.getByText("そのチャプターのメンバーが承認します")).toBeVisible();

  // Two approvals of the host account at once still make one sns post.
  const hostTarget = await page
    .getByRole("list", { name: "配信先" })
    .getByRole("listitem")
    .filter({ hasText: "@chapter1" })
    .locator('input[name="target"]')
    .getAttribute("value");
  const approve = () =>
    page.request.post(draftUrl, { form: { intent: "target-approve", target: String(hostTarget) } });
  const responses = await Promise.all([approve(), approve()]);
  expect(responses.map((r) => r.status())).toEqual([200, 200]);
  await page.reload();
  await expect(page.getByRole("list", { name: "配信先" }).getByText("予約済み")).toHaveCount(1);
  let state = await mocks(request);
  const hostPosts = state.sns.posts.filter(
    (p) => p.chapterId === 1 && p.text.includes(`https://gdgs.jp/${slug}-x-`),
  );
  expect(hostPosts).toHaveLength(1);
  expect(hostPosts[0]?.text).toContain("https://gdgs.jp/");
  expect(hostPosts[0]?.text).not.toContain("{{shortlink}}");

  // The co-host organizer approves their own account; sns sees their claims.
  await signIn(page, "osaka", "2:gdgoc-osaka:organizer");
  await page.goto(draftUrl);
  await page.getByRole("button", { name: "@chapter2 で予約" }).click();
  await expect(page.getByText("@chapter2 に予約しました")).toBeVisible();
  state = await mocks(request);
  const osakaPost = state.sns.posts.filter((p) => p.chapterId === 2).at(-1);
  expect(osakaPost?.actor).toBe("dev-user-osaka");

  // sns publishes the host post → the hourly cron marks it done.
  await request.post("/dev/mock-services", { form: { publish: hostPosts[0]?.id ?? "" } });
  await cron(request, "hourly");
  await page.reload();
  await expect(page.getByRole("list", { name: "配信先" }).getByText("投稿済み")).toBeVisible();

  // The dead destination: red after two hourly checks, and one Discord alert.
  await cron(request, "hourly");
  const alerts = (await messages(request)).filter(
    (m) => m.hook === hook && m.content.includes("リンク切れ") && m.content.includes(slug),
  );
  expect(alerts).toHaveLength(1);
  await signIn(page, "lead", "1:gdg-kwansai:organizer");
  await page.goto(`/c/${slug}/settings`);
  await expect(
    page.getByRole("list", { name: "短縮リンク" }).getByText("リンク切れ"),
  ).toBeVisible();
});
