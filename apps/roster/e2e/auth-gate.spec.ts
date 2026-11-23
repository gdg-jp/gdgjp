import { expect, test } from "@playwright/test";

test("unauthenticated visitor to / is redirected to signin with return_to", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/signin?return_to=%2F");
});
