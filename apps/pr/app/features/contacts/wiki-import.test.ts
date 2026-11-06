import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { organizationKey } from "./contact";
import { duplicateOrganizations, parseOutreachPage, splitList } from "./wiki-import";

const page = readFileSync(
  new URL("../../../fixtures/wiki/outreach-targets.md", import.meta.url),
  "utf8",
);

describe("parseOutreachPage", () => {
  const contacts = parseOutreachPage(page);

  it("reads people, kinds and organizations", () => {
    expect(contacts).toContainEqual({
      wikiPerson: "針猫（ゆにねこ）",
      kind: "school",
      name: "IPUT",
      organization: "iput",
    });
    expect(contacts).toContainEqual(
      expect.objectContaining({
        wikiPerson: "Naoya Yoshimura（Getty708）",
        kind: "lab",
        name: "理研",
      }),
    );
    expect(contacts.filter((c) => c.wikiPerson === null).map((c) => c.name)).toEqual([
      "近畿大学",
      "京都大学",
    ]);
  });

  it("keeps parentheses inside one entry", () => {
    expect(splitList("KUPAC（京大フィジカルAI）、Discord（GDGoC Japan / OUCC、x）")).toEqual([
      "KUPAC（京大フィジカルAI）",
      "Discord（GDGoC Japan / OUCC、x）",
    ]);
  });

  it("normalizes organization names so duplicates group", () => {
    expect(organizationKey("京都大学（KUPAC） ")).toBe(organizationKey("京都大学"));
    expect([...duplicateOrganizations(contacts)]).toContain(organizationKey("大阪電気通信大学"));
  });

  it("never imports emails or phone numbers", () => {
    const text = JSON.stringify(contacts);
    expect(text).not.toMatch(/@example\.com|090-1234/);
  });
});
