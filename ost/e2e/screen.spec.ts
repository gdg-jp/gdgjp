import { expect, test } from "@playwright/test";

const SLUG = "e2e";

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/dev/seed?slug=${SLUG}&title=E2E%20Event&chapter=1:dev-chapter`);
  expect(res.ok()).toBeTruthy();
});

test("a submitted topic appears live on the screen and can be voted on", async ({ browser }) => {
  const admin = await browser.newPage();
  // Dev sign-in: session cookie + chapter 1 membership, then land on the screen.
  await admin.goto(`/dev/login?as=owner&chapter=1:dev-chapter&return_to=/${SLUG}/screen`);
  await expect(admin.getByText("ライブ")).toBeVisible();

  const participant = await browser.newPage();
  const topic = `live topic ${Date.now()}`;
  await participant.goto(`/${SLUG}`);
  await participant.getByRole("textbox").fill(topic);
  await participant.getByRole("button", { name: "送信する" }).click();
  await expect(participant.getByRole("heading", { name: "送信しました 🎉" })).toBeVisible();

  await expect(admin.getByText(topic)).toBeVisible();

  // Vote from the participant dialog; the screen's count reflects it.
  await participant.goto(`/${SLUG}`);
  await participant.getByRole("button", { name: "投票する" }).click();
  await participant.getByRole("button", { name: "👍" }).first().click();
  await expect(admin.getByText("1 票")).toBeVisible();

  await admin.close();
  await participant.close();
});

test("screen page redirects an unauthenticated visitor to sign in", async ({ request }) => {
  const res = await request.get(`/${SLUG}/screen`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("/signin");
});
