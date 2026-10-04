import { describe, expect, it } from "vitest";
import { loader } from "./home";

describe("home route", () => {
  it("redirects to /links", () => {
    try {
      loader();
      throw new Error("loader did not throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      const res = thrown as Response;
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/links");
    }
  });
});
