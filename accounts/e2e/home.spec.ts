import { expect, test } from "@playwright/test";

test("home page redirects unauthenticated users to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  const discovery = await page.request.get("/.well-known/openid-configuration");
  expect(discovery.status()).toBe(200);
  expect(discovery.headers()["content-type"]).toContain("application/json");
  const metadata = await discovery.json();
  expect(metadata.issuer).toBe("http://localhost:5173");
  expect(metadata.authorization_endpoint).toBe("http://localhost:5173/api/auth/oauth2/authorize");
});

test("Google sign in starts with a document navigation", async ({ page }) => {
  await page.route("**/oauth/google/start*", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.goto("/signin");

  const startRequest = page.waitForRequest((request) =>
    request.url().includes("/oauth/google/start"),
  );
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const request = await startRequest;

  expect(new URL(request.url()).pathname).toBe("/oauth/google/start");
  expect(request.resourceType()).toBe("document");
});

test("RP authorization creates a signed continuation accepted by Google sign-in", async ({
  page,
}) => {
  const query = new URLSearchParams({
    client_id: "wiki",
    response_type: "code",
    redirect_uri: "http://localhost:5177/api/auth/callback/gdgjp",
    scope: "openid email profile",
    state: "google-signin-regression",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });
  const authorize = await page.request.get(`/api/auth/oauth2/authorize?${query}`, {
    headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" },
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const signin = new URL(authorize.headers().location, authorize.url());
  expect(signin.pathname).toBe("/signin");
  expect(signin.searchParams.get("sig")).toBeTruthy();
  expect(Number(signin.searchParams.get("exp"))).toBeGreaterThan(Date.now() / 1000);

  await page.route("**/oauth/google/start*", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const google = new URL(response.headers().location);
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/oauth/google/callback",
    );
    await route.fulfill({ status: 200, body: "Google sign-in started" });
  });
  await page.goto(signin.toString());
  await page.getByRole("button", { name: /Continue with Google|Google で続行/ }).click();
  await expect(page.locator("body")).toHaveText("Google sign-in started");
});
