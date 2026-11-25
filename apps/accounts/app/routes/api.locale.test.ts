import { describe, expect, it } from "vitest";
import { action } from "./api.locale";

async function switchLocale(returnTo: string): Promise<Response> {
  const body = new FormData();
  body.set("locale", "en");
  body.set("return_to", returnTo);
  return action({
    request: new Request("https://accounts.example/api/locale", { method: "POST", body }),
  } as never);
}

describe("locale switch", () => {
  it("returns to the page the visitor switched on", async () => {
    const response = await switchLocale("/chapters/tokyo?tab=1");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/chapters/tokyo?tab=1");
    expect(response.headers.get("Set-Cookie")).toContain("i18next=");
  });

  it.each(["/\t/evil.example", "//evil.example", "https://evil.example/", "/\\evil.example"])(
    "stays on Accounts for the return target %j",
    async (returnTo) => {
      const response = await switchLocale(returnTo);

      expect(response.headers.get("Location")).toBe("/dashboard");
    },
  );
});
