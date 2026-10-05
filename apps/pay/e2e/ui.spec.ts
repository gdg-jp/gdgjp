import { type Page, expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/__ui-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>',
    }),
  );
});

// This verifies rendering/interaction with fixture loader data, not authenticated backend workflows.
async function screen(page: Page, name: string, theme: string, state = "default") {
  await page.goto("/__ui-harness");
  await page.evaluate(
    async ({ name, theme, state }) => {
      // React Router route modules require the dev HMR preamble in this fixture document.
      const refreshModule = "/@id/__x00__virtual:react-router/hmr-runtime";
      const refresh = await import(/* @vite-ignore */ refreshModule);
      refresh.default.injectIntoGlobalHook(window);
      const runtime = window as typeof window & {
        $RefreshReg$: () => void;
        $RefreshSig$: () => (type: unknown) => unknown;
        __vite_plugin_react_preamble_installed__: boolean;
      };
      runtime.$RefreshReg$ = () => {};
      runtime.$RefreshSig$ = () => (type) => type;
      runtime.__vite_plugin_react_preamble_installed__ = true;
      const fixtureModule = "/e2e/ui-harness.tsx";
      const fixture = await import(/* @vite-ignore */ fixtureModule);
      fixture.renderScreen(name, state, theme);
    },
    { name, theme, state },
  );
  await expect(page.locator("main h1")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`real screens at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const name of ["home", "event", "new-event", "profile", "new-claim", "proxy", "claim"]) {
        await screen(page, name, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page
            .locator("input:not([type=hidden])")
            .evaluateAll((inputs) =>
              inputs.every((input) => !!(input as HTMLInputElement).labels?.length),
            ),
        ).toBe(true);
        await page.keyboard.press("Tab");
        await expect(page.locator("header > div > a").first()).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

test("menus, keyboard focus, form semantics and feedback states", async ({ page }) => {
  await screen(page, "claim", "light");
  await page.getByLabel("アカウント", { exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "サインアウト" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("アカウント", { exact: true })).toBeFocused();
  await page.getByLabel("GDG アプリ", { exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "TinyURL" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("GDG アプリ", { exact: true })).toBeFocused();
  await expect(page.getByLabel("月日", { exact: false })).toHaveCount(2);
  const ids = await page
    .locator("input[id]")
    .evaluateAll((inputs) => inputs.map((input) => input.id));
  expect(new Set(ids).size).toBe(ids.length);
  await expect(
    page.getByRole("button", { name: "comm-support に確認メールを送る" }),
  ).toBeDisabled();
  for (const name of ["profile", "new-event", "proxy", "claim"]) {
    await screen(page, name, "dark", "error");
    await expect(page.getByRole("alert")).toContainText("入力内容を確認してください");
  }
  await screen(page, "home", "light", "empty");
  await expect(
    page.getByText("まだイベントがありません。最初のイベントを登録してください。"),
  ).toBeVisible();
  await screen(page, "event", "dark", "warning");
  await expect(page.getByRole("status")).toContainText("口座情報の登録が必要です");
  await screen(page, "claim", "light", "readonly");
  await expect(page.getByRole("button", { name: "アップロードして抽出" })).toHaveCount(0);
});
