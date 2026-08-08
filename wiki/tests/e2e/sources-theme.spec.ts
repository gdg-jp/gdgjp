import { expect, test } from "./fixtures";

test("Google Chat reauthorization warning uses dark-mode warning tokens", async ({ adminPage }) => {
  await adminPage.addInitScript(() => localStorage.setItem("theme", "dark"));
  await adminPage.route("**/api/google-chat/spaces", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ reauthorize: true }),
    });
  });
  await adminPage.goto("/sources");

  await adminPage.getByRole("button", { name: "Load spaces you belong to" }).click();
  const warningText = adminPage.getByText("Google Chat permission is missing.");
  await expect(warningText).toBeVisible();
  const warning = warningText.locator("..");

  await expect(warning).toHaveClass(/bg-feedback-warning-surface/);
  await expect(warning).toHaveClass(/text-feedback-warning-foreground/);
  await expect
    .poll(() =>
      warning.evaluate((element) => {
        const color = getComputedStyle(element).color;
        const background = getComputedStyle(element).backgroundColor;
        return `${color}|${background}`;
      }),
    )
    .not.toBe("rgb(255, 255, 255)|rgb(255, 255, 255)");
});
