import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import rulesJson from "@skills/pr-playbook/rules.json";
import { describe, expect, it } from "vitest";
import { constants } from "~/features/playbook/playbook";
import { digestJson } from "./access.server";

const fileDigest = (name: string) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        JSON.parse(
          readFileSync(
            new URL(`../../../../../skills/pr-playbook/${name}`, import.meta.url),
            "utf8",
          ),
        ),
      ),
    )
    .digest("hex");

describe("export baseRevision", () => {
  it("matches the digest feedback.mjs computes from the files", async () => {
    expect(await digestJson(rulesJson)).toBe(fileDigest("rules.json"));
    expect(await digestJson(constants)).toBe(fileDigest("constants.json"));
  });
});
