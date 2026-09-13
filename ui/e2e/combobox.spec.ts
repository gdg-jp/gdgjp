import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=components-combobox--${name}&viewMode=story`;

test("searchable Combobox keeps input focus and active descendant keyboard semantics", async ({
  page,
}) => {
  await page.goto(story("searchable"));
  const input = page.getByRole("combobox", { name: "候補を検索" });
  const list = page.getByRole("listbox");
  const options = list.getByRole("option");

  await expect(input).toBeFocused();
  await expect(options).toHaveCount(3);
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await options.nth(0).getAttribute("id"),
  );

  await input.press("ArrowDown");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await options.nth(1).getAttribute("id"),
  );
  await input.press("End");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await options.nth(2).getAttribute("id"),
  );
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await options.nth(2).getAttribute("id"),
  );
  await input.press("Home");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await options.nth(0).getAttribute("id"),
  );

  await input.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("button", { name: "チャプターを選択" })).toBeFocused();

  await page.getByRole("button", { name: "チャプターを選択" }).click();
  await expect(input).toBeFocused();
  await input.press("Tab");
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("button", { name: "チャプターを選択" })).not.toBeFocused();
});

test("controlled query filters locally while remote mode renders consumer results unchanged", async ({
  page,
}) => {
  await page.goto(story("controlled-query"));
  const input = page.getByRole("combobox", { name: "候補を検索" });
  await input.fill("関西");
  await expect(page.getByTestId("combobox-query")).toHaveText("関西");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: "Osaka" })).toHaveAttribute("data-active", "true");

  await page.goto(story("remote"));
  const remoteInput = page.getByRole("combobox", { name: "候補を検索" });
  await remoteInput.fill("osaka");
  await expect(page.getByRole("option", { name: "Osaka" })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(1);
});

test("closeOnSelect false preserves multiple-selection composition and focus", async ({ page }) => {
  await page.goto(story("multiple"));
  const input = page.getByRole("combobox", { name: "候補を検索" });
  const list = page.getByRole("listbox");

  await page.getByRole("option", { name: "Tokyo" }).click();
  await expect(list).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByTestId("combobox-selected")).toHaveText("tokyo");

  await page.getByRole("option", { name: "Osaka" }).click();
  await expect(page.getByTestId("combobox-selected")).toHaveText("tokyo, osaka");
  await expect(list).toBeVisible();
  await expect(input).toBeFocused();
});

test("disabled options are excluded from active and selection state", async ({ page }) => {
  await page.goto(story("disabled"));
  const input = page.getByRole("combobox", { name: "候補を検索" });
  const disabled = page.getByRole("option", { name: "Disabled venue" });
  const available = page.getByRole("option", { name: "Available venue" });

  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveAttribute("aria-disabled", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", await available.getAttribute("id"));
  await input.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("active identity survives result reorder and navigation follows DOM order", async ({
  page,
}) => {
  await page.goto(story("reordered"));
  const input = page.getByRole("combobox", { name: "候補を検索" });
  const options = page.getByRole("option");

  await input.press("ArrowDown");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await options.nth(1).getAttribute("id"),
  );
  await page
    .getByRole("button", { name: "Reverse results" })
    .evaluate((element) => element.click());
  await input.focus();
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await page.getByRole("option", { name: "Osaka" }).getAttribute("id"),
  );
  await input.press("ArrowDown");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    await page.getByRole("option", { name: "Tokyo" }).getAttribute("id"),
  );
});

test("combobox states remain accessible", async ({ page }) => {
  await page.goto(story("searchable"));
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
