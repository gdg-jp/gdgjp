import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const TINYURL_URL = `http://localhost:${process.env.CI ? 6174 : 5174}`;

test("confirming Delete tag? deletes the tag", async ({ page, context }) => {
  await context.route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.fulfill({ status: 204 }),
  );
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const chapter = `${9000 + Math.floor(Math.random() * 900)}:tags-${suffix}:member`;
  const login = await page.goto(
    `${TINYURL_URL}/dev/login?as=tags${suffix}&chapter=${encodeURIComponent(chapter)}&return_to=/tags`,
  );
  expect(login?.status()).toBeLessThan(400);

  const name = `e2e-${suffix}`;
  const created = await page.request.post(`${TINYURL_URL}/tags`, {
    form: { intent: "create", name, color: "gray", scope: "user" },
  });
  expect(created.status()).toBe(200);

  await page.goto(`${TINYURL_URL}/tags`);
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const alert = page.getByRole("alertdialog", { name: "Delete tag?" });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Delete" }).click();

  await expect(alert).toBeHidden();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No tags yet")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
});
