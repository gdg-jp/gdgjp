import { describe, expect, it } from "vitest";
import { readDisplayPreferences } from "./display-preferences";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

describe("readDisplayPreferences", () => {
  it("reads the defaults shared by link collections", () => {
    expect(
      readDisplayPreferences(
        storageWith(
          JSON.stringify({
            layout: "rows",
            sort: "mostClicks",
            showArchived: true,
            properties: ["shortLink", "title", "unknown"],
          }),
        ),
      ),
    ).toEqual({
      layout: "rows",
      sort: "mostClicks",
      showArchived: true,
      properties: ["shortLink", "title"],
    });
  });

  it("falls back when no defaults have been saved", () => {
    expect(readDisplayPreferences(storageWith(null))).toMatchObject({
      layout: "cards",
      sort: "newest",
      showArchived: false,
    });
  });
});
