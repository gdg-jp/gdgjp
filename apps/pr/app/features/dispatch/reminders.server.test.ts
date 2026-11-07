import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { constants } from "~/features/playbook/playbook";

describe("reminder text", () => {
  it("lives in the Playbook, not in TS (no Japanese literal in the sender)", () => {
    for (const file of ["./reminders.server.ts", "../notify/send.server.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      const literals = source.match(/(["'`])(?:(?!\1).)*[぀-ヿ一-鿿](?:(?!\1).)*\1/g) ?? [];
      expect(
        literals.filter((l) => !l.includes("${")),
        file,
      ).toEqual([]);
    }
  });
  it("has a template for every message the cron sends", () => {
    for (const name of [
      "staff",
      "story",
      "review",
      "followup",
      "delegated",
      "discordPost",
      "linkBroken",
      "approvalDue",
      "digest",
    ])
      expect(constants.reminders.templates).toHaveProperty(name);
  });
});
