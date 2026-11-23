import { type Browser, type Page, expect, test } from "@playwright/test";

test("unauthenticated visitor to / is redirected to signin", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/signin?return_to=%2F");
});

async function switchTrack(page: Page, track: string) {
  await page.getByRole("tab", { name: track }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(`トラック ${track} に切り替えますか？`)).toBeVisible();
  await dialog.getByRole("button", { name: "切り替える" }).click();
  await expect(page.getByRole("tab", { name: track })).toHaveAttribute("aria-selected", "true");
}

async function openController(page: Page, track = "A"): Promise<string> {
  await page.goto("/dev/login?as=e2e&return_to=/");
  await expect(page.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
  if (track !== "A") await switchTrack(page, track);
  await page.getByRole("button", { name: "診断" }).click();
  await expect(page.getByText(`Player URL (Track ${track})`)).toBeVisible();
  const url = page.getByTestId("player-url");
  await expect(url).toHaveValue(new RegExp(`/play\\?track=${track}&t=[0-9a-f]{64}$`));
  const playerUrl = await url.inputValue();
  await page.keyboard.press("Escape");
  return playerUrl;
}

async function openPlayer(browser: Browser, playerUrl: string): Promise<Page> {
  const context = await browser.newContext();
  const player = await context.newPage();
  await player.goto(playerUrl);
  return player;
}

test("play is acknowledged by the player, and stopping asks first", async ({ page, browser }) => {
  const playerUrl = await openController(page);
  const player = await openPlayer(browser, playerUrl);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "ok");

  const card = page.locator(".mc-card").nth(2);
  await card.getByRole("button", { name: "再生", exact: true }).click();
  await expect(card).toHaveAttribute("data-status", "playing");
  await expect(card.getByRole("button", { name: "再生済み" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const bar = page.locator(".mc-bar");
  await expect(bar).toBeVisible();

  const seconds = async () => {
    const [m, sec] = (await card.locator(".mc-card-duration").innerText()).split(":").map(Number);
    return m * 60 + sec;
  };
  const first = await seconds();
  await expect.poll(seconds, { timeout: 5000 }).toBeLessThan(first);

  await bar.getByRole("button", { name: "停止" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("再生を停止しますか？")).toBeVisible();
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(card).toHaveAttribute("data-status", "playing");

  await bar.getByRole("button", { name: "停止" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "停止する" }).click();
  await expect(card).toHaveAttribute("data-status", "paused");

  await bar.getByRole("button", { name: "再生", exact: true }).click();
  await expect(card).toHaveAttribute("data-status", "playing");
  await bar.getByRole("button", { name: "停止" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "停止する" }).click();
  await expect(card).toHaveAttribute("data-status", "paused");

  await player.context().close();
});

test("a lost player is flagged within seconds and recovers on its own", async ({
  page,
  browser,
}) => {
  const playerUrl = await openController(page);
  const player = await openPlayer(browser, playerUrl);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "ok");

  await player.context().setOffline(true);
  await expect(page.getByTestId("issue")).toHaveText("配信PCが接続されていません", {
    timeout: 6000,
  });

  await player.context().setOffline(false);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "ok", {
    timeout: 8000,
  });
  await expect(page.getByTestId("issue")).toHaveCount(0);
  await player.context().close();
});

test("a command with no player fails immediately and visibly", async ({ page }) => {
  await openController(page);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "down", {
    timeout: 6000,
  });
  await page.locator(".mc-card").first().getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.getByText("配信PCが接続されていません").first()).toBeVisible();
});

test("a player with a wrong token never counts as connected", async ({ page, browser }) => {
  const playerUrl = await openController(page);
  const player = await openPlayer(
    browser,
    playerUrl.replace(/t=[0-9a-f]+$/, `t=${"0".repeat(64)}`),
  );
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "down");
  await player.context().close();
});

test("each track is its own channel", async ({ page, browser }) => {
  const urlA = await openController(page, "A");
  const playerA = await openPlayer(browser, urlA);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "ok");

  await switchTrack(page, "B");
  await page.getByRole("button", { name: "診断" }).click();
  const urlB = await page.getByTestId("player-url").inputValue();
  await page.keyboard.press("Escape");
  expect(urlB).toMatch(/\/play\?track=B&t=[0-9a-f]{64}$/);
  expect(new URL(urlB).searchParams.get("t")).not.toBe(new URL(urlA).searchParams.get("t"));
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "down", {
    timeout: 6000,
  });
  await page.locator(".mc-card").first().getByRole("button", { name: "再生", exact: true }).click();
  await expect(page.getByText("配信PCが接続されていません").first()).toBeVisible();

  const crossed = await openPlayer(
    browser,
    urlB.replace(/t=[0-9a-f]+$/, `t=${new URL(urlA).searchParams.get("t")}`),
  );
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "down");
  await crossed.context().close();

  await switchTrack(page, "A");
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "ok");
  const card = page.locator(".mc-card").first();
  await card.getByRole("button", { name: "再生", exact: true }).click();
  await expect(card).toHaveAttribute("data-status", "playing");
  await page.locator(".mc-bar").getByRole("button", { name: "停止" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "停止する" }).click();
  await expect(card).toHaveAttribute("data-status", "paused");
  await playerA.context().close();
});

test("switching tracks asks first, and cancelling stays put", async ({ page }) => {
  await openController(page);
  await page.getByRole("tab", { name: "B" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".mc-card-file").first()).toHaveText("01_0930");
});

test("reissuing the Player URL needs two confirmations", async ({ page }) => {
  const before = await openController(page);
  await page.getByRole("button", { name: "診断" }).click();
  const dialog = page.getByRole("alertdialog");

  await page.getByRole("button", { name: "再発行" }).click();
  await expect(dialog.getByText("Player URL を再発行しますか？")).toBeVisible();
  await dialog.getByRole("button", { name: "再発行する" }).click();
  await expect(dialog.getByText("本当に Player URL を再発行しますか？")).toBeVisible();
  await expect(dialog.getByText("配信されません")).toBeVisible();
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("player-url")).toHaveValue(before);

  await page.getByRole("button", { name: "再発行" }).click();
  await dialog.getByRole("button", { name: "再発行する" }).click();
  await expect(dialog.getByText("本当に Player URL を再発行しますか？")).toBeVisible();
  await dialog.getByRole("button", { name: "再発行する" }).click();
  await expect(page.getByTestId("player-url")).not.toHaveValue(before);
});

function testWav(): Buffer {
  const rate = 8000;
  const parts: [boolean, number][] = [
    [true, 1.5],
    [false, 0.4],
    [true, 1.5],
  ];
  const samples = parts.flatMap(([sound, sec]) =>
    Array.from({ length: Math.round(sec * rate) }, (_, i) =>
      sound ? Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)) : 0,
    ),
  );
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("an uploaded clip reaches the player and can be edited and deleted", async ({
  page,
  browser,
}) => {
  const playerUrl = await openController(page);
  const player = await openPlayer(browser, playerUrl);
  await expect(page.getByTestId("player-lamp")).toHaveAttribute("data-state", "ok");
  const title = `e2e ${Date.now()}`;

  await page.getByRole("button", { name: "音声を追加", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByTestId("clip-file").setInputFiles({
    name: "e2e.wav",
    mimeType: "audio/wav",
    buffer: testWav(),
  });
  await expect(sheet.getByText("e2e.wav")).toBeVisible();
  await expect(sheet.getByText("0:03")).toBeVisible();
  await sheet.getByLabel("見出し").fill(title);
  await sheet.getByLabel("テキスト").fill("一行目です。\n二行目です。");
  await sheet.getByRole("button", { name: "登録" }).click();
  await expect(sheet).toBeHidden();

  const card = page.locator(".mc-card").last();
  await expect(card).toContainText(title);
  await expect(card).toContainText("一行目です。二行目です。");

  await card.getByRole("button", { name: "再生", exact: true }).click();
  await expect(card).toHaveAttribute("data-status", "playing");
  await expect(card).toHaveAttribute("data-status", "ended", { timeout: 8000 });

  await card.getByRole("button", { name: "編集" }).click();
  await sheet.getByLabel("見出し").fill(`${title} 改`);
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  await expect(card).toContainText(`${title} 改`);

  await card.getByRole("button", { name: "編集" }).click();
  await sheet.getByRole("button", { name: "削除" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("この音声を削除しますか？")).toBeVisible();
  await confirm.getByRole("button", { name: "削除する" }).click();
  await expect(page.locator(".mc-card", { hasText: title })).toHaveCount(0);

  await player.context().close();
});
