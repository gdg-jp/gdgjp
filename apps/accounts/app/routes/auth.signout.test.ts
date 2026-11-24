import { describe, expect, it, vi } from "vitest";

const signOut = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Response(null, {
        status: 200,
        headers: { "Set-Cookie": "better-auth.session_token=; Max-Age=0; Path=/" },
      }),
  ),
);

vi.mock("~/features/auth/auth.server", () => ({
  authUnavailableResponse: () => new Response(null, { status: 503 }),
  getAuth: () => ({ api: { signOut } }),
  withAuthTimeout: (operation: Promise<Response>) => operation,
}));

import { loader } from "./auth.signout";

async function signOutTo(returnTo: string | null): Promise<Response> {
  const url = new URL("https://accounts.example/auth/signout");
  if (returnTo !== null) url.searchParams.set("return_to", returnTo);
  try {
    await loader({ request: new Request(url), context: { cloudflare: { env: {} } } } as never);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
  throw new Error("Expected the loader to redirect");
}

describe("Accounts sign-out", () => {
  it("ends the session and returns to a same-origin target", async () => {
    const response = await signOutTo("/invite/abc");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/invite/abc");
    expect(response.headers.get("Set-Cookie")).toContain("better-auth.session_token=;");
  });

  it.each([null, "/\t/evil.example", "//evil.example", "https://evil.example/"])(
    "returns to the sign-in page for the return target %j",
    async (returnTo) => {
      const response = await signOutTo(returnTo);

      expect(response.headers.get("Location")).toBe("/signin");
    },
  );
});
