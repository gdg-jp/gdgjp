#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const skill = dirname(dirname(fileURLToPath(import.meta.url)));
const root = resolve(skill, "../../..");
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  assert(["--mutation-proof", "--allow-source-drift"].includes(arg), `Unknown option: ${arg}`);
}
const coverage = JSON.parse(await readFile(join(skill, "coverage.json"), "utf8"));
const hashes = Object.fromEntries(
  await Promise.all(
    Object.keys(coverage.sources).map(async (name) => [
      name,
      createHash("sha256")
        .update(await readFile(join(root, name)))
        .digest("hex"),
    ]),
  ),
);
const drift = Object.keys(hashes).filter((name) => hashes[name] !== coverage.sources[name]);
const sourceFile = join(root, "packages/gdg-lib/src/acl/core.ts");
const source = await readFile(sourceFile, "utf8");
const chapters = ["tokyo", "osaka", "outside"];
const levels = [null, "member", "organizer"];
const members = levels.flatMap((a) =>
  levels.flatMap((b) =>
    levels.map((c) =>
      [a, b, c].flatMap((role, index) => (role ? [{ chapterId: chapters[index], role }] : [])),
    ),
  ),
);
const channels = [
  { kind: "private" },
  { kind: "member" },
  { kind: "organizer" },
  ...chapters.flatMap((chapterId) => [
    { kind: "chapter-member", chapterId },
    { kind: "chapter-organizer", chapterId },
  ]),
];
const chapterIds = [null, "", ...chapters];
const sourceVisibilities = [
  "private",
  "member",
  "organizer",
  "chapter-member",
  "chapter-organizer",
  "unknown",
];
const pageVisibilities = [
  "public",
  "unlisted",
  "member",
  "organizer",
  "restricted",
  "private",
  "chapter-member",
  "chapter-organizer",
  "unknown",
];
const grantEntries = [
  ...chapters.map((subjectKey) => ({ subjectType: "chapter", subjectKey })),
  { subjectType: "email", subjectKey: "someone@example.invalid" },
  { subjectType: "unknown", subjectKey: "tokyo" },
];
const grants = [
  [],
  ...grantEntries.map((entry) => [entry]),
  ...grantEntries.flatMap((first) => grantEntries.map((second) => [first, second])),
];

function expectedSourceAccess(person, visibility, chapterId) {
  const sameChapter = person.find((entry) => entry.chapterId === chapterId);
  return (
    (visibility === "member" && person.length > 0) ||
    (visibility === "organizer" && person.some((entry) => entry.role === "organizer")) ||
    (visibility === "chapter-member" && Boolean(sameChapter)) ||
    (visibility === "chapter-organizer" && sameChapter?.role === "organizer")
  );
}
function expectedPageAccess(person, page) {
  return (
    page.visibility === "public" ||
    page.visibility === "unlisted" ||
    (page.visibility === "member" && person.length > 0) ||
    (page.visibility === "organizer" && person.some((entry) => entry.role === "organizer")) ||
    (page.visibility === "restricted" &&
      page.access.some(
        (grant) =>
          grant.subjectType === "chapter" &&
          person.some((entry) => entry.chapterId === grant.subjectKey),
      ))
  );
}
const viewers = new Map(
  channels.map((channel) => [
    channel,
    members.filter((person) => expectedSourceAccess(person, channel.kind, channel.chapterId)),
  ]),
);

function failure(property, input) {
  const error = new Error(`${property}: ${JSON.stringify(input)}`);
  error.property = property;
  error.counterexample = input;
  throw error;
}
function verify(implementation) {
  let sourceCases = 0;
  let pageCases = 0;
  let allowedSources = 0;
  let allowedPages = 0;
  for (const visibility of sourceVisibilities) {
    for (const chapterId of chapterIds) {
      const source = { visibility, chapterId };
      for (const classes of members) {
        for (const channel of channels) {
          sourceCases += 1;
          if (!implementation.canClassesAccessSourceInChannel(source, classes, channel)) continue;
          allowedSources += 1;
          if (!expectedSourceAccess(classes, visibility, chapterId)) {
            failure("source-caller-access", { source, classes, channel });
          }
          const deniedViewer = viewers
            .get(channel)
            .find((person) => !expectedSourceAccess(person, visibility, chapterId));
          if (deniedViewer)
            failure("source-channel-confinement", { source, classes, channel, deniedViewer });
        }
      }
    }
  }
  for (const visibility of pageVisibilities) {
    for (const chapterId of chapterIds) {
      for (const access of grants) {
        const page = { visibility, chapterId, access };
        for (const classes of members) {
          for (const channel of channels) {
            pageCases += 1;
            if (!implementation.canClassesSeePageInChannel(page, classes, channel)) continue;
            allowedPages += 1;
            if (!expectedPageAccess(classes, page))
              failure("page-caller-access", { page, classes, channel });
            const deniedViewer = viewers.get(channel).find((person) => !expectedPageAccess(person, page));
            if (deniedViewer)
              failure("page-channel-confinement", { page, classes, channel, deniedViewer });
          }
        }
      }
    }
  }
  const person = [{ chapterId: "tokyo", role: "member" }];
  const channel = { kind: "chapter-member", chapterId: "tokyo" };
  if (
    !implementation.canClassesAccessSourceInChannel(
      { visibility: "chapter-member", chapterId: "tokyo" },
      person,
      channel,
    )
  ) {
    failure("source-positive-witness", { person, channel });
  }
  if (
    !implementation.canClassesSeePageInChannel(
      {
        visibility: "restricted",
        chapterId: "tokyo",
        access: [{ subjectType: "chapter", subjectKey: "tokyo" }],
      },
      person,
      channel,
    )
  ) {
    failure("page-positive-witness", { person, channel });
  }
  return { sourceCases, pageCases, allowedSources, allowedPages };
}

const report = {
  verifier: "bounded exhaustive execution of production TypeScript",
  node: process.version,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  syncedCommit: coverage.syncedCommit,
  sources: hashes,
  sourceDrift: drift,
  bounds: {
    chapters,
    membershipVectors: members.length,
    channels: channels.length,
    sourceVisibilities,
    pageVisibilities,
    chapterIds,
    grantArrays: grants.length,
    maxGrants: 2,
  },
  baseline: null,
  mutations: [],
  restoredBaseline: null,
};
let exitCode = 0;
try {
  const implementation = await import(pathToFileURL(sourceFile).href);
  report.baseline = { verdict: "PASS", ...verify(implementation) };
  if (args.has("--mutation-proof")) {
    const mutants = [
      [
        "source-channel-confinement",
        "canClassesAccessSource(source, classes) &&\n    audienceKeyContains(channel, sourceKey)",
        "canClassesAccessSource(source, classes)",
      ],
      ["source-caller-access", "canClassesAccessSource(source, classes) &&", "true &&"],
      [
        "page-channel-confinement",
        "canClassesSeePage(page, classes) && pageAudienceIncludesChannel(page, channel)",
        "canClassesSeePage(page, classes)",
      ],
      [
        "page-caller-access",
        "canClassesSeePage(page, classes) && pageAudienceIncludesChannel(page, channel)",
        "pageAudienceIncludesChannel(page, channel)",
      ],
      ["source-positive-witness", "sourceKey !== null &&", "false && sourceKey !== null &&"],
      [
        "page-positive-witness",
        "return canClassesSeePage(page, classes) &&",
        "return false && canClassesSeePage(page, classes) &&",
      ],
    ];
    const scratch = await mkdtemp(join(tmpdir(), "gdgjp-acl-mutants-"));
    try {
      for (const [expectedProperty, before, after] of mutants) {
        assert.equal(
          source.split(before).length,
          2,
          `Mutation anchor changed: ${expectedProperty}`,
        );
        const mutantPath = join(scratch, `${expectedProperty}.ts`);
        await writeFile(mutantPath, source.replace(before, after));
        const mutant = await import(pathToFileURL(mutantPath).href);
        let counterexample;
        try {
          verify(mutant);
        } catch (error) {
          if (error.property !== expectedProperty) throw error;
          counterexample = error.counterexample;
        }
        assert(counterexample, `Mutation survived: ${expectedProperty}`);
        report.mutations.push({ property: expectedProperty, verdict: "CAUGHT", counterexample });
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    assert.equal(
      await readFile(sourceFile, "utf8"),
      source,
      "Production source changed during verification",
    );
    report.restoredBaseline = { verdict: "PASS", ...verify(implementation) };
  }
  if (drift.length && !args.has("--allow-source-drift")) {
    report.verdict = "SOURCE REVIEW REQUIRED";
    exitCode = 2;
  } else report.verdict = "PASS";
} catch (error) {
  report.verdict = "FAIL";
  report.error = {
    message: error.message,
    property: error.property,
    counterexample: error.counterexample,
  };
  exitCode = 1;
}
const evidenceDir = join(root, "local_data/pstack/acl-boundaries");
await mkdir(evidenceDir, { recursive: true });
const evidence = join(
  evidenceDir,
  `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.json`,
);
await writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      baseline: report.baseline,
      mutations: report.mutations.map(({ property, verdict }) => ({ property, verdict })),
      sourceDrift: drift,
      evidence,
    },
    null,
    2,
  ),
);
if (report.error) console.error(report.error.message);
process.exitCode = exitCode;
