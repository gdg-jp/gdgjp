import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-kind knowledge lives in two tables (`app/features/sources/kinds.ts`) and in the
 * import drivers (`workers/features/sources/import/<driver>/`). Anywhere else, comparing a
 * kind literal re-scatters that knowledge: adding a kind would again need edits across
 * UI, API and cron. There is deliberately no allowlist.
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(relRoot: string): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(`${relDir}/${entry.name}`);
        }
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(`${relDir}/${entry.name}`);
      }
    }
  };
  walk(relRoot);
  return out;
}

const KIND_LITERALS = [
  "google-doc",
  "google-sheet",
  "google-slides",
  "google-chat-space",
  "google-drive",
  "discord-channel",
  "discord-guild",
  "website",
  "upload",
  "conversation",
  "url",
  "text",
].join("|");
// `<something kind> === "<literal>"`, either order. Only expressions naming a kind count, so
// unrelated comparisons such as `node.type === "text"` are not flagged.
const COMPARISON = new RegExp(
  `[kK]ind\\)?\\s*[!=]==\\s*"(${KIND_LITERALS})"|"(${KIND_LITERALS})"\\s*[!=]==\\s*\\S*[kK]ind\\b`,
);
// `switch (x.kind)` … `case "<literal>"` — only literals that are unambiguous source kinds.
const CASE =
  /case\s+"(google-doc|google-sheet|google-slides|google-chat-space|google-drive|discord-channel|discord-guild|conversation)"/;

function allowed(file: string): boolean {
  return (
    file === "app/features/sources/kinds.ts" ||
    file.startsWith("app/features/sources/kinds/") ||
    /^workers\/features\/sources\/import\/[^/]+\//.test(file)
  );
}

describe("source kind branches", () => {
  it("compares source-kind literals only in kinds.ts and the import drivers", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("workers")]) {
      if (allowed(file)) continue;
      const lines = readFileSync(join(WIKI_ROOT, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (COMPARISON.test(line) || CASE.test(line)) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
