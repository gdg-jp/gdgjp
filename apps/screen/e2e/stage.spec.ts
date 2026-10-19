import { type Browser, type Page, expect, test } from "@playwright/test";

/**
 * End-to-end through the real Cloudflare Realtime SFU: a speaker with fake
 * camera/mic joins, the operator puts them on slot A, and the OBS camera
 * output starts receiving frames. Needs REALTIME_APP_ID/TOKEN in .dev.vars.
 */

async function operatorPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    locale: "ja-JP",
    permissions: ["clipboard-read", "clipboard-write", "camera", "microphone"],
  });
  const page = await context.newPage();
  await page.goto("/dev/login?as=e2e-op&return_to=/");
  return page;
}

async function createStage(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "ステージを作成" }).first().click();
  await page.getByRole("textbox", { name: "名前" }).fill(name);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/stages\/[a-z]+-[a-z]+-[a-z]+$/);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

async function copied(page: Page, action: () => Promise<void>): Promise<string> {
  await action();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^http/);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  return text;
}

test("speaker goes on air through an OBS output", async ({ browser }) => {
  test.skip(!process.env.SCREEN_E2E_SFU && !!process.env.CI, "needs Realtime credentials");
  const op = await operatorPage(browser);
  const stageId = await createStage(op, `e2e ${Date.now()}`);
  expect(stageId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  await expect(op.getByRole("button", { name: "ON AIR" })).toBeVisible();

  const invite = await copied(op, async () => {
    await op.getByRole("button", { name: "メニュー" }).click();
    await op.getByRole("menuitem", { name: "招待リンクをコピー" }).click();
  });
  const cameraUrl = await copied(op, async () => {
    await op.getByRole("button", { name: "OBS", exact: true }).click();
    await op.getByRole("button", { name: "A カメラ の URL をコピー" }).click();
  });
  const micUrl = await copied(op, async () => {
    await op.getByRole("button", { name: "A マイク の URL をコピー" }).click();
  });
  await op.keyboard.press("Escape");

  // Speaker: lobby → room.
  const speakerContext = await browser.newContext({
    locale: "ja-JP",
    permissions: ["camera", "microphone"],
  });
  const speaker = await speakerContext.newPage();
  const speakerLog: string[] = [];
  speaker.on("console", (m) => speakerLog.push(`${m.type()}: ${m.text()}`));
  speaker.on("pageerror", (e) => speakerLog.push(`pageerror: ${e.message}`));
  expect(invite).toMatch(/\/[a-z]+-[a-z]+-[a-z]+\/$/);
  await speaker.goto(invite);
  // Join stays pressable; without a name it explains why instead of joining.
  await speaker.getByRole("button", { name: "参加" }).click();
  await expect(speaker.getByRole("alert")).toHaveText("お名前を入力してください");
  await speaker.getByRole("textbox", { name: "お名前" }).fill("E2E Speaker");
  await expect(speaker.getByRole("alert")).toHaveCount(0);
  // Device menus sit next to the toggles.
  await speaker.getByRole("button", { name: "カメラの設定" }).click();
  await expect(speaker.getByRole("menuitemradio").first()).toBeVisible();
  await speaker.keyboard.press("Escape");
  await speaker.getByRole("button", { name: "参加" }).click();
  await expect(speaker.locator(".sc-chip[data-tone='ok']")).toBeVisible({ timeout: 20_000 });

  // Operator sees the speaker and assigns slot A.
  await expect(op.locator(".sc-person-name", { hasText: "E2E Speaker" })).toBeVisible({
    timeout: 15_000,
  });
  await op.getByRole("radio", { name: "A に出力" }).click();
  await expect(speaker.locator(".sc-slot-badge")).toHaveText("A");

  // OBS camera output receives frames and is visible.
  const outContext = await browser.newContext();
  const out = await outContext.newPage();
  await out.goto(`${cameraUrl}&debug=1`);
  await expect
    .poll(() => out.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0)
    .catch(async (err) => {
      console.log(speakerLog.join("\n"));
      console.log(
        await speaker.evaluate(() => ({
          self: (
            document.querySelector(
              ".sc-room-side figure:last-child video",
            ) as HTMLVideoElement | null
          )?.videoWidth,
          text: document.body.innerText.slice(0, 400),
        })),
      );
      throw err;
    });
  await expect(out.locator(".sc-out-frame")).toHaveCSS("opacity", "1");

  // OBS mic output gets a live audio track.
  const outMic = await outContext.newPage();
  await outMic.goto(micUrl);
  await expect
    .poll(
      () =>
        outMic.evaluate(() => {
          const el = document.querySelector("audio");
          const stream = el?.srcObject as MediaStream | null;
          return stream?.getAudioTracks()[0]?.readyState ?? "none";
        }),
      { timeout: 30_000 },
    )
    .toBe("live");

  // Operator monitor shows the speaker's camera in slot A.
  await expect
    .poll(
      () =>
        op.evaluate(
          () =>
            (document.querySelector(".sc-slot .sc-slot-tile video") as HTMLVideoElement | null)
              ?.videoWidth ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  // A reload mid-talk returns to slot A without touching anything, and the
  // OBS output picks up the new SFU session.
  await speaker.reload();
  await expect(speaker.locator(".sc-slot-badge")).toHaveText("A", { timeout: 20_000 });
  await expect(speaker.locator(".sc-chip[data-tone='ok']")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        out.evaluate(() => {
          const v = document.querySelector("video");
          const track = (v?.srcObject as MediaStream | null)?.getVideoTracks()[0];
          return track?.readyState === "live" && !track.muted && (v?.videoWidth ?? 0) > 0;
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
    .catch(async (err) => {
      console.log(await out.locator(".sc-out-debug").textContent());
      throw err;
    });
  await expect(out.locator(".sc-out-frame")).toHaveCSS("opacity", "1");

  // Screen sharing reaches the OBS screen output.
  const screenUrl = cameraUrl.replace("/A/camera", "/A/screen");
  const outScreen = await outContext.newPage();
  await outScreen.goto(screenUrl);
  await speaker.getByRole("button", { name: "画面を共有" }).first().click();
  await expect
    .poll(() => outScreen.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // ON AIR turns the speaker's indicator red; a cue appears large.
  await op.getByRole("button", { name: "ON AIR" }).click();
  await expect(speaker.locator(".sc-chip[data-tone='onair']")).toBeVisible();
  await op.getByRole("button", { name: "残り 5 分" }).click();
  await expect(speaker.getByRole("alert")).toContainText("5 minutes left");
  await speaker.getByRole("button", { name: "OK" }).click();
  await expect(speaker.getByRole("alert")).toHaveCount(0);

  // Unassigning hides the OBS output at once.
  await op.getByRole("button", { name: "A の割り当てを解除" }).click();
  await expect(out.locator(".sc-out-frame")).toHaveCSS("opacity", "0");

  // Clean up.
  await op.getByRole("button", { name: "メニュー" }).click();
  await op.getByRole("menuitem", { name: "削除" }).click();
  await op.getByRole("button", { name: "削除" }).click();
  await op.waitForURL(/\/$/);
  await Promise.all([op.context().close(), speakerContext.close(), outContext.close()]);
});

test("invalid invite links say so", async ({ page }) => {
  await page.goto("/join/not-a-token");
  await expect(page.getByText("リンクが無効です")).toBeVisible();
});
