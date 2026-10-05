import { expect, test } from "@playwright/test";

test("home page redirects unauthenticated users to the local sign-in route", async ({
  request,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/signin?return_to=%2F");
});

test("an unknown public image returns 404", async ({ request }) => {
  const response = await request.get("/__definitely-missing-image__");
  expect(response.status()).toBe(404);
});
