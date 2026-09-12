import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
const story = (id: string, theme = "light") =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`;
const axeForGdgUi = (page: Page, tags: string[]) =>
  new AxeBuilder({ page })
    .withTags(tags)
    // GDG brand controls intentionally use the documented 3:1 control threshold;
    // axe's color-contrast rule applies the 4.5:1 text threshold to their labels.
    .exclude(".gdg-button-primary")
    .exclude(".gdg-button-secondary");
test("component stories size their preview to the rendered content", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto(story("components-accordion--default"));
  const preview = page.locator(".gdg-story-preview");
  await expect(preview).toBeVisible();
  const previewHeight = await preview.evaluate((element) => element.getBoundingClientRect().height);
  expect(previewHeight).toBeLessThan(page.viewportSize()?.height ?? 0);
});
test("message scroller keeps the latest item at the viewport edge", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto(story("components-messagescroller--latest-messages", "dark"));
  const scroller = page.locator(".gdg-message-scroller");
  const viewport = scroller.locator(".gdg-message-scroller-viewport");
  const latest = viewport.locator(".gdg-message-scroller-item").last();
  await expect(latest).toBeVisible();
  await expect(scroller.locator(".gdg-message-scroller-button")).toHaveCSS("position", "absolute");
  await expect
    .poll(() =>
      viewport.evaluate((element) => {
        const latestItem = element.querySelector(".gdg-message-scroller-item:last-child");
        if (!latestItem) return Number.POSITIVE_INFINITY;
        return element.getBoundingClientRect().bottom - latestItem.getBoundingClientRect().bottom;
      }),
    )
    .toBeLessThanOrEqual(12);
});
test("scroll area constrains long content and supports wheel scrolling", async ({ page }) => {
  await page.goto(story("components-scrollarea--long-list"));
  const viewport = page.locator(".gdg-scroll-area-viewport");
  await expect(viewport).toBeVisible();

  const dimensions = await viewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await viewport.hover();
  await page.mouse.wheel(0, 160);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
test("message avatars align with the left edge and top of message content", async ({ page }) => {
  await page.goto(story("components-message--conversation"));
  const avatar = page.locator(".gdg-message-avatar").first();
  const content = page.locator(".gdg-message-content").first();
  await expect(avatar).toBeVisible();
  await expect(content).toBeVisible();

  const [avatarBox, contentBox] = await Promise.all([avatar.boundingBox(), content.boundingBox()]);
  expect(avatarBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  if (!avatarBox || !contentBox)
    throw new Error("Message layout elements must have bounding boxes");
  expect(avatarBox.x + avatarBox.width).toBeLessThanOrEqual(contentBox.x);
  expect(avatarBox.y).toBe(contentBox.y);
});
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
  await expect(page.getByText("Escで閉じ、起点へ戻ります。")).toHaveCSS("margin-top", "0px");
  await expect(page.getByText("Escで閉じ、起点へ戻ります。")).toHaveCSS("margin-bottom", "0px");
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
test("radio group animates pointer changes and keeps keyboard changes instant", async ({
  page,
}) => {
  await page.goto(story("components-radiogroup--default"));
  const venue = page.locator("#venue-option");
  const online = page.locator("#online-option");
  const venueIndicator = venue.locator(".gdg-radio-indicator");
  const onlineIndicator = online.locator(".gdg-radio-indicator");

  await expect(venue).toBeChecked();
  await expect(venue).toHaveCSS("transition-duration", "0.12s");
  await expect(venueIndicator).toHaveCSS("transition-duration", "0.12s, 0.12s");
  await online.click();
  await expect(online).toBeChecked();
  await expect(venue).not.toBeChecked();
  await expect(venueIndicator).toHaveAttribute("data-state", "unchecked");
  await expect(onlineIndicator).toHaveAttribute("data-state", "checked");

  await venue.focus();
  await page.keyboard.press("Space");
  await expect(venue).toBeChecked();
  await expect(venue).toHaveCSS("transition-duration", "0s");
  await expect(venueIndicator).toHaveCSS("transition-duration", "0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(venueIndicator).toHaveCSS("transition-property", "opacity");
  await expect(venueIndicator).toHaveCSS("transform", "none");
});
test("questionnaire choices animate pointer changes and keep keyboard changes instant", async ({
  page,
}) => {
  await page.goto(story("components-questionnaire--steps"));
  const venue = page.locator(".gdg-questionnaire-choice").filter({ hasText: "会場" });
  const online = page.locator(".gdg-questionnaire-choice").filter({ hasText: "オンライン" });
  const venueIndicator = venue.locator(".gdg-questionnaire-choice-indicator");
  const onlineIndicator = online.locator(".gdg-questionnaire-choice-indicator");

  await expect(venue).toHaveCSS("transition-duration", "0.12s, 0.12s, 0.12s, 0.12s");
  await expect(venueIndicator).toHaveCSS("transition-duration", "0.12s, 0.12s, 0.12s");
  await venue.hover();
  await expect
    .poll(() => venue.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe("none");
  await online.click();
  await expect(online).toHaveAttribute("data-state", "checked");
  await expect(venue).toHaveAttribute("data-state", "unchecked");
  await expect(onlineIndicator.locator("svg")).toHaveCSS("opacity", "1");

  await venue.locator("input").focus();
  await page.keyboard.press("Space");
  await expect(venue).toHaveAttribute("data-state", "checked");
  await expect(venue).toHaveCSS("transition-duration", "0s");
  await expect(venueIndicator).toHaveCSS("transition-duration", "0s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const reducedIndicator = page.locator(".gdg-questionnaire-choice-indicator").first();
  await expect(reducedIndicator).toHaveCSS("transform", "none");
  await expect(reducedIndicator.locator("svg")).toHaveCSS("transition-property", "opacity");
});
test("skeleton shimmer respects reduced motion", async ({ page }) => {
  await page.goto(story("components-skeleton--card-placeholder"));
  const skeleton = page.locator(".gdg-skeleton").first();
  await expect
    .poll(() => skeleton.evaluate((element) => getComputedStyle(element, "::after").animationName))
    .toBe("gdg-skeleton-shimmer");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect
    .poll(() => skeleton.evaluate((element) => getComputedStyle(element, "::after").animationName))
    .toBe("none");
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
    const results = await axeForGdgUi(page, [
      "wcag2a",
      "wcag2aa",
      "wcag21aa",
      "wcag22aa",
    ]).analyze();
    expect(results.violations).toEqual([]);
    await page.getByRole("button", { name: "Dialog", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(20, 20, 20)" : "rgb(255, 255, 255)",
    );
    await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
    expect((await axeForGdgUi(page, ["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
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
        (await axeForGdgUi(page, ["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations,
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
  const alertDialogTitle = page.getByRole("heading", { name: "イベントを削除しますか？" });
  await expect(alertDialogTitle).toHaveClass(/gdg-heading/);
  await expect(alertDialogTitle).toHaveCSS("margin", "0px");
  await expect(page.getByText("このサンプル一覧からイベントを取り除きます。")).toHaveClass(
    /gdg-text gdg-muted/,
  );
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "イベントがありません" })).toBeVisible();
});
test("storybook theme control and sample navigation remain interactive", async ({ page }) => {
  await page.goto(story("patterns-admin--default"));
  await page.getByLabel("配色").selectOption("dark");
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.getByLabel("配色")).toHaveValue("dark");

  for (const destination of ["リンク", "メンバー", "設定", "イベント"]) {
    const link = page.getByRole("link", { name: destination, exact: true });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: destination, exact: true })).toBeVisible();
  }
  await page.goBack();
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "ナビゲーション" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "設定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
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
  await expect(page.getByTestId("secondary")).toHaveCSS("background-color", "rgb(93, 137, 157)");
  await expect(page.getByTestId("secondary")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "utility override" })).toHaveCSS(
    "border-radius",
    "24px",
  );
  await expect(page.getByRole("button", { name: "utility override" })).toHaveCSS(
    "padding-left",
    "32px",
  );
});

test("finite-radius surfaces use squircles while circles and pills stay round", async ({
  page,
}) => {
  await catalog(page);
  const supportsSquircle = await page.evaluate(() => CSS.supports("corner-shape", "squircle"));
  test.skip(!supportsSquircle, "The browser does not support CSS corner-shape yet.");

  const shapes = await page.evaluate(() => {
    const shape = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).getPropertyValue("corner-shape") : null;
    };
    return {
      card: shape(".gdg-card"),
      button: shape(".gdg-button"),
      badge: shape(".gdg-badge"),
      avatar: shape(".gdg-avatar"),
      switch: shape(".gdg-switch"),
    };
  });
  expect(shapes).toEqual({
    card: "squircle",
    button: "squircle",
    badge: "round",
    avatar: "round",
    switch: "round",
  });

  await page.goto(story("components-sidebarnav--default"));
  await expect(page.locator(".gdg-sidebar-nav a").first()).toBeVisible();
  await expect(page.locator(".gdg-sidebar-nav a").first()).toHaveCSS("corner-shape", "squircle");

  await page.goto(story("components-slider--volume"));
  await expect(page.locator(".gdg-slider-track")).toHaveCSS("corner-shape", "round");
  await expect(page.locator(".gdg-slider-thumb")).toHaveCSS("corner-shape", "round");
});

test("secondary button uses configurable default and hover colors", async ({ page }) => {
  await page.goto(story("components-button--variants"));
  const secondary = page.getByRole("button", { name: "Secondary", exact: true });
  await expect(secondary).toHaveCSS("background-color", "rgb(93, 137, 157)");
  await secondary.hover();
  await expect(secondary).toHaveCSS("background-color", "rgb(107, 154, 174)");
  await expect(secondary).toHaveCSS("color", "rgb(255, 255, 255)");
  await page
    .locator("html")
    .evaluate((element) => element.style.setProperty("--gdg-secondary-hover", "#456f80"));
  await expect(secondary).toHaveCSS("background-color", "rgb(69, 111, 128)");
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
  await expect(toast).toHaveCSS("border-top-width", "0px");
  expect(await toast.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
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
      await page.getByLabel("表示名").evaluate((element) => {
        element.scrollLeft = 0;
      });
      await expect(page).toHaveScreenshot(`catalog-${theme}-${width}.png`, {
        fullPage: true,
        animations: "disabled",
        // The shared macOS/Linux baseline differs slightly in font rasterization on this text-heavy capture.
        maxDiffPixelRatio: 0.01,
      });
    });
  }
