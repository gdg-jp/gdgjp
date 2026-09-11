import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
const story = (id: string, theme = "light") =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`;
async function catalog(page: Page) {
  await page.goto(story("components-catalog--all"));
  await expect(page.getByRole("heading", { name: "GDG Apps" })).toBeVisible();
}
test("field association, keyboard dialogs and focus restoration", async ({ page }) => {
  await catalog(page);
  await expect(page.getByLabel("表示名")).toHaveAttribute("required", "");
  await expect(page.getByLabel("メールアドレス")).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Dialog", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCSS("transition-duration", "0s");
  await expect(page.getByLabel("ダイアログ内の入力")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dialog", exact: true })).toBeFocused();
});
test("select, tabs, accordion and menu support keyboard navigation", async ({ page }) => {
  await catalog(page);
  await page.getByRole("combobox", { name: "公開設定" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "公開設定" })).toContainText("公開");
  await page.getByRole("tab", { name: "概要" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tabpanel")).toContainText("詳細の内容");
  await page.getByRole("button", { name: "参加方法を教えてください" }).click();
  await expect(page.getByText("イベントページから登録できます。")).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "編集" })).toBeFocused();
  await page.keyboard.press("Escape");
});
test("pointer exits are inert and reopen without stale state", async ({ page }) => {
  await catalog(page);
  const trigger = page.getByRole("button", { name: "Dialog", exact: true });
  for (let i = 0; i < 3; i++) {
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    const closed = page.locator('.gdg-dialog[data-state="closed"]');
    expect(await closed.evaluateAll((elements) => elements.every((el) => el.inert))).toBe(true);
    await expect(page.locator(".gdg-dialog")).toHaveCount(0);
  }
  await trigger.click();
  await expect(page.getByLabel("ダイアログ内の入力")).toBeEditable();
});
test("reduced motion and forced colors preserve state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await catalog(page);
  await page.getByRole("button", { name: "Dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("transform", "none");
  await expect(page.getByRole("dialog")).toHaveCSS("transition-property", "opacity");
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("checkbox")).toBeChecked();
});
for (const theme of ["light", "dark"]) {
  test(`accessible catalog and portal — ${theme}`, async ({ page }) => {
    await page.goto(story("components-catalog--all", theme));
    await expect(page.getByRole("heading", { name: "GDG Apps" })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.getByRole("button", { name: "Dialog", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 20)" : "rgb(255, 255, 255)",
    );
    await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
  });
  for (const width of [390, 1280])
    test(`admin visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(story("patterns-admin--default", theme));
      await expect(page.getByRole("heading", { name: "イベント", exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`admin-${theme}-${width}.png`, {
        fullPage: true,
        animations: "disabled",
      });
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze())
          .violations,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 390) {
        await page.getByRole("button", { name: "ナビゲーション" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      }
    });
}
test("sample editing, empty state, toast and confirmation", async ({ page }) => {
  await page.goto(story("patterns-admin--default"));
  await page.getByRole("button", { name: "イベントを作成" }).click();
  await page
    .getByLabel("イベント名")
    .fill("開発者コミュニティのための非常に長い日本語イベント名を含む表示確認");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await page.getByRole("button", { name: "イベントを削除", exact: true }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "イベントがありません" })).toBeVisible();
});
test("200 percent text zoom remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto(story("patterns-admin--default"));
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await page.getByRole("button", { name: "イベントを作成" }).click();
  await expect(page.getByLabel("イベント名")).toBeVisible();
});

test("SSR pre-paint theme, hydration, persistence and system changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("gdg-apps-theme", "dark");
  });
  // Block hydration first: theme must already be correct from the SSR bootstrap.
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.goto("http://127.0.0.1:6017");
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.locator(".gdg-card")).toHaveCSS("background-color", "rgb(20, 20, 20)");
  await page.unroute("**/assets/*.js");
  errors.length = 0;
  await page.reload();
  await expect(page.getByLabel("配色")).toBeEnabled();
  await page.getByLabel("配色").selectOption("light");
  await expect(page.locator("html")).toHaveClass("light");
  expect(await page.evaluate(() => localStorage.getItem("gdg-apps-theme"))).toBe("light");
  await page.getByLabel("配色").selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass("light");
  expect(errors).toEqual([]);
});

test("Tailwind CSS-first config and utility overrides work from package exports", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:6017/tailwind.html");
  await expect(page.getByTestId("accent")).toHaveCSS("background-color", "rgb(249, 171, 0)");
  await expect(page.getByRole("button", { name: "utility override" })).toHaveCSS(
    "border-radius",
    "12px",
  );
  await expect(page.getByRole("button", { name: "utility override" })).toHaveCSS(
    "padding-left",
    "32px",
  );
});

test("disabled asChild, grouped labels, native select validation", async ({ page }) => {
  await page.goto(story("components-contracts--examples"));
  await page.getByRole("link", { name: "無効なリンク" }).dispatchEvent("click");
  await expect(page.getByRole("status", { name: "クリック回数" })).toHaveText("0");
  await expect(page.getByRole("radiogroup", { name: "参加場所" })).toBeVisible();
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByRole("status", { name: "送信値" })).toHaveText("");
  await page.getByRole("combobox", { name: "必須チャプター" }).click();
  await page.getByRole("option", { name: "Tokyo" }).click();
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByRole("status", { name: "送信値" })).toHaveText("tokyo");
});
test("reopening during exit cancels stale teardown", async ({ page }) => {
  await page.goto(story("components-contracts--examples"));
  await page.getByRole("button", { name: "連続開閉Dialog" }).click();
  await page.getByRole("button", { name: "閉じてすぐ開く" }).click();
  await expect(page.locator('.gdg-dialog[data-state="open"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "閉じてすぐ開く" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "連続開閉Select" }).click();
  await page.getByRole("option", { name: "候補1" }).click();
  await expect(page.locator(".gdg-select-trigger").first()).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByRole("option", { name: "候補2" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
test("toast uses theme and motion tokens", async ({ page }) => {
  await page.goto(story("components-contracts--examples", "dark"));
  await page.getByRole("button", { name: "通知を表示" }).click();
  const toast = page.locator("[data-sonner-toast]");
  await expect(toast).toHaveCSS("background-color", "rgb(20, 20, 20)");
  await expect(toast).toHaveCSS("transition-duration", "0.25s, 0.25s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toast).toHaveCSS("transition-property", "opacity");
});

for (const theme of ["light", "dark"])
  for (const width of [390, 1280]) {
    test(`component state matrix ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(story("components-catalog--all", theme));
      await expect(page.getByRole("heading", { name: "GDG Apps" })).toBeVisible();
      await page
        .getByLabel("表示名")
        .fill("コミュニティのみなさんと一緒に学ぶための長い日本語の表示名");
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`catalog-${theme}-${width}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }
