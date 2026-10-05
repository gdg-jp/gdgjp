import { expect, test } from "@playwright/test";

/**
 * Stage 01's one required E2E (docs/roster/01-workspace-scaffold.md
 * Verification): the auth gate must redirect an unauthenticated visitor from
 * `/` to sign-in with `return_to` preserved. Every later stage builds on this
 * gate holding.
 */
test("unauthenticated visitor to / is redirected to signin with return_to", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/signin?return_to=%2F");
});
