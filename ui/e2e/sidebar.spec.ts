import { expect, test } from "@playwright/test";

test("sidebar trigger stays beside the title and collapses to navigation icons", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto("/iframe.html?id=components-sidebar--navigation&viewMode=story");

  const sidebar = page.locator(".gdg-sidebar-component");
  const title = sidebar.getByText("GDG Apps", { exact: true });
  const groupLabel = sidebar.locator(".gdg-sidebar-group-label");
  const trigger = sidebar.locator(".gdg-sidebar-trigger");
  await expect(title).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-label", "サイドバーを閉じる");
  await expect(sidebar.locator(".gdg-sidebar-header")).toHaveCSS("flex-direction", "row");
  await expect(title).toHaveClass("gdg-sidebar-title");
  await expect(title).toHaveCSS("font-family", /Google Sans/);
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => title.evaluate(() => document.fonts.check(`16px "Google Sans"`)))
    .toBe(true);

  const [titleBox, triggerBox] = await Promise.all([title.boundingBox(), trigger.boundingBox()]);
  if (!titleBox || !triggerBox) throw new Error("Sidebar title and trigger should be measurable");
  expect(triggerBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
  expect(triggerBox.width).toBe(triggerBox.height);

  await expect(groupLabel).toHaveCSS("transition-property", "height");
  const collapseTransition = groupLabel.evaluate(
    (element) =>
      new Promise<string>((resolve) => {
        element.addEventListener(
          "transitionrun",
          (event) => resolve((event as TransitionEvent).propertyName),
          { once: true },
        );
      }),
  );
  await trigger.click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("aria-label", "サイドバーを開く");
  await expect(title).toBeHidden();
  await expect(sidebar.locator(".gdg-sidebar-menu-button").first()).toHaveCSS("font-size", "0px");
  await expect(sidebar.locator(".gdg-sidebar-menu-button svg").first()).toBeVisible();
  await expect(collapseTransition).resolves.toBe("height");
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(64);
  await expect
    .poll(() =>
      groupLabel.evaluate((element) => Math.round(element.getBoundingClientRect().height)),
    )
    .toBe(16);
  const insetBox = await page.locator(".gdg-sidebar-inset").boundingBox();
  expect(insetBox?.x).toBe(64);

  const openingTransition = groupLabel.evaluate(
    (element) =>
      new Promise<string>((resolve) => {
        element.addEventListener(
          "transitionrun",
          (event) => resolve((event as TransitionEvent).propertyName),
          { once: true },
        );
      }),
  );
  await trigger.click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(openingTransition).resolves.toBe("height");
  const openingFrame = await page.evaluate(() => {
    const title = document.querySelector(".gdg-sidebar-header > strong");
    const menuButton = document.querySelector(".gdg-sidebar-menu-button");
    return {
      titleHeight: title?.getBoundingClientRect().height ?? 0,
      menuButtonHeight: menuButton?.getBoundingClientRect().height ?? 0,
    };
  });
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("white-space", "nowrap");
  await expect(sidebar.locator(".gdg-sidebar-menu-button").first()).toHaveCSS(
    "white-space",
    "nowrap",
  );
  expect(openingFrame.titleHeight).toBeLessThan(40);
  expect(openingFrame.menuButtonHeight).toBeLessThan(64);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(groupLabel).toHaveCSS("transition-property", "none");
});
