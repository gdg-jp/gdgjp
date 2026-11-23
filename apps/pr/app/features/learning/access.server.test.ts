import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

const feedbackScript = new URL(
  "../../../../../skills/pr-playbook/scripts/feedback.mjs",
  import.meta.url,
);

describe.skipIf(!existsSync(feedbackScript))("digest contract with feedback.mjs", () => {
  it("agrees with digestOf on a fixture whose formatting is not canonical", async () => {
    const { digestOf } = (await import(feedbackScript.href)) as {
      digestOf: (path: string) => string;
    };
    const text =
      '{\n  "rules" : [ {"id":"X-1", "note":"告知は確定後"} ],\n\t"limit": 1.50, "on": true }\n';
    const dir = mkdtempSync(join(tmpdir(), "pr-digest-"));
    try {
      const path = join(dir, "fixture.json");
      writeFileSync(path, text);
      expect(await digestJson(JSON.parse(text))).toBe(digestOf(path));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const rulesPath = fileURLToPath(new URL("../rules.json", feedbackScript));
    expect(await digestJson(rulesJson)).toBe(digestOf(rulesPath));
  });
});
