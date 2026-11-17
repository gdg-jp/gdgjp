import { expect, test } from "@playwright/test";

const accountsUrl = `http://localhost:${process.env.CI ? 6173 : 5173}`;
const snsUrl = `http://localhost:${process.env.CI ? 6178 : 5178}`;

test("signed-out visitors continue to Accounts with a protected SNS return path", async ({
  page,
}) => {
  await page.goto("/posts", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL((url) => url.origin === accountsUrl && url.pathname === "/signin");
  const url = new URL(page.url());
  expect(url.searchParams.get("client_id")).toBe("sns");
  expect(url.searchParams.get("redirect_uri")).toBe(`${snsUrl}/api/auth/callback/gdgjp`);
  expect(url.searchParams.get("scope")).toContain("openid");
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
});

test("the posts API rejects requests without a bearer identity", async ({ request }) => {
  const response = await request.get("/api/cli/v1/posts?chapterId=1");
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});
