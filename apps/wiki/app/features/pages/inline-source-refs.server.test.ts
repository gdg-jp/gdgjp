import { describe, expect, it } from "vitest";
import { inlineSourceIds } from "./inline-source-refs.server";

describe("inlineSourceIds", () => {
  it("collects each cited id once, from either bracket style", () => {
    expect(
      inlineSourceIds(
        "a（source: FNFVEcXXHArML5Yru8ts6）b (source: 2vAZAkU5HJ83TzgsChXOw) c (source: FNFVEcXXHArML5Yru8ts6)",
      ),
    ).toEqual(["FNFVEcXXHArML5Yru8ts6", "2vAZAkU5HJ83TzgsChXOw"]);
    expect(inlineSourceIds("(source: ab)")).toEqual([]);
  });
});
