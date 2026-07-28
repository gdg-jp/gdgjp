import { describe, expect, it } from "vitest";
import { meta as homeMeta } from "./home";
import { meta as privacyMeta } from "./privacy";
import { meta as termsMeta } from "./terms";

describe("public website routes", () => {
  it("defines homepage metadata", () => {
    expect(homeMeta()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "GDG Japan" }),
        expect.objectContaining({ property: "og:url", content: "https://gdgs.jp/" }),
      ]),
    );
  });

  it("defines privacy and terms metadata", () => {
    expect(privacyMeta()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining("プライバシー") }),
      ]),
    );
    expect(termsMeta()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining("利用規約") }),
      ]),
    );
  });
});
