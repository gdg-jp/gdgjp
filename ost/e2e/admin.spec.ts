import { expect, test } from "@playwright/test";

test("a submitted topic appears live on the admin screen", async ({ browser }) => {
  const admin = await browser.newPage();
  await admin.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(admin.getByRole("heading", { name: "Open Space Technology" })).toBeVisible();
  // Wait for the WebSocket to report "ライブ".
  await expect(admin.getByText("ライブ")).toBeVisible();

  const participant = await browser.newPage();
  await participant.goto("/", { waitUntil: "domcontentloaded" });
  const topic = `live topic ${Date.now()}`;
  await participant.getByRole("textbox").fill(topic);
  await participant.getByRole("button", { name: "送信する" }).click();
  await expect(participant.getByRole("heading", { name: "送信しました 🎉" })).toBeVisible();

  await expect(admin.getByText(topic)).toBeVisible();

  // Clean up so repeated local runs stay readable.
  admin.on("dialog", (dialog) => dialog.accept());
  await admin.getByRole("button", { name: "すべてクリア" }).click();
  await expect(admin.getByText("テーマを募集中…")).toBeVisible();

  await admin.close();
  await participant.close();
});
