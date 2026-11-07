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

describe("parseOutreachPage on the table form", () => {
  const tables = parseOutreachPage(
    readFileSync(
      new URL("../../../fixtures/wiki/outreach-targets-tables.md", import.meta.url),
      "utf8",
    ),
  );
  const pairs = tables.map((c) => [c.wikiPerson, c.kind, c.name]);

  it("reads one table per person, splitting 「a／b」 and stripping ACL spans and links", () => {
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["針猫（ゆにねこ）", "community", "AIAU"],
        ["針猫（ゆにねこ）", "school", "大阪大学掲示板"],
        ["針猫（ゆにねこ）", "school", "大阪電気通信大学"],
        ["針猫（ゆにねこ）", "media", "X @gdsc_osaka（GDGoC Osaka）"],
        ["針猫（ゆにねこ）", "community", "HackBar"],
        ["Hasu", "school", "神戸大学"],
      ]),
    );
  });

  it("drops notes after 。, unknown kinds, emails and the 注意 section", () => {
    expect(pairs.filter(([p]) => p === "Hasu").map(([, , n]) => n)).toEqual([
      "神戸大学",
      "神戸大学",
    ]);
    expect(JSON.stringify(tables)).not.toMatch(/example\.com|謎の行|ここは読まない|acl/);
  });

  it("takes the person from a 人 column and pairs kinds with targets when counts match", () => {
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["藤田彩翔", "school", "京都産業大学"],
        ["藤田彩翔", "community", "Tech.Uni"],
        ["吉村", "lab", "理研"],
        ["吉村", "lab", "STECH"],
      ]),
    );
  });

  it("keeps list entries in 担当未記載 without a person", () => {
    expect(tables.filter((c) => c.wikiPerson === null).map((c) => c.name)).toEqual(["京都大学"]);
  });
});
