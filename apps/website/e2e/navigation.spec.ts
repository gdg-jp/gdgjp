import { expect, test } from "@playwright/test";

test("visitors can read both policies and return to the service directory", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "コミュニティの活動を、もっと身近に。",
  );
  const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
  await navigation.getByRole("link", { name: "プライバシー", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("プライバシーポリシー");
  await navigation.getByRole("link", { name: "利用規約", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("利用規約");
  await page.getByRole("link", { name: "GDG Japan ホーム" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "コミュニティの活動を、もっと身近に。",
  );
  await expect(page.getByRole("link", { name: "TinyURL", exact: true })).toHaveAttribute(
    "href",
    "https://url.gdgs.jp",
  );
});
