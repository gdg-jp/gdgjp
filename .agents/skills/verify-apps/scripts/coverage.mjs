#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(skill, "../../..");

export function mapJourneys(features = join(skill, "features")) {
  const journeys = [];
  for (const app of readdirSync(features, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const readme = join(features, app.name, "README.md");
    if (!existsSync(readme)) continue;
    for (const line of readFileSync(readme, "utf8").split("\n")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const id = /^`([a-z0-9-]+)`$/.exec(cells[0] ?? "")?.[1];
      if (!id?.startsWith(`${app.name}-`) || cells.length < 4) continue;
      const scope = cells.at(-1);
      const inMap = /^(in map|local)/i.test(scope);
      journeys.push({
        id,
        app: app.name,
        map: `features/${app.name}/README.md`,
        feature: cells[1],
        identity: cells[2],
        inMap,
        ...(inMap ? {} : { exclusion: scope }),
      });
    }
  }
  return journeys;
}

function records(run) {
  return readdirSync(run)
    .filter((name) => name === "journeys.json" || name.endsWith("-journeys.json"))
    .flatMap((name) => {
      const data = JSON.parse(readFileSync(join(run, name), "utf8"));
      return (Array.isArray(data) ? data : data.journeys).map((record) => ({
        ...record,
        file: join(run, name),
      }));
    });
}

function summary(record) {
  if (record.failure) return String(record.failure);
  return (record.observations ?? [])
    .map(({ observed }) => observed)
    .filter(Boolean)
    .join(" ");
}

export function merge(journeys, previous, runs, root = repository) {
  const prior = new Map((previous?.journeys ?? []).map((row) => [row.id, row]));
  const rows = journeys.map((journey) => {
    const old = prior.get(journey.id);
    return {
      ...journey,
      status: old?.status ?? "NOT VERIFIED",
      observedAt: old?.observedAt ?? null,
      evidence: old?.evidence ?? [],
      result: old?.result ?? null,
    };
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const unmapped = [];
  for (const run of runs) {
    for (const record of records(run)) {
      const row = byId.get(record.id);
      if (!row) {
        unmapped.push(record.id);
        continue;
      }
      if (!["VERIFIED", "FAILED"].includes(record.status)) continue;
      row.status = record.status;
      row.observedAt = record.observedAt;
      row.evidence = [relative(root, record.file)];
      row.result = summary(record);
      row.sourceSnapshot = relative(root, join(run, "run.json"));
    }
  }
  return { rows, unmapped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runs = process.argv.slice(2).map((path) => resolve(path));
  const path = join(skill, "coverage.json");
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const { rows, unmapped } = merge(mapJourneys(), previous, runs);
  const runEvidence = [
    ...new Set([...(previous?.runEvidence ?? []), ...runs.map((run) => relative(repository, run))]),
  ];
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        scope:
          "Local Orca journeys for screen, OST, MC, Deck, Roulette, Img, Meet, website, Live Check-in, and Roster",
        sourceBaseCommit: previous?.sourceBaseCommit ?? null,
        runEvidence,
        journeys: rows,
        exclusions: previous?.exclusions ?? [],
      },
      null,
      2,
    )}\n`,
  );
  const counts = Object.groupBy(rows, (row) => (row.inMap ? row.status : "OUTSIDE"));
  console.log(
    JSON.stringify(
      Object.fromEntries(Object.entries(counts).map(([key, list]) => [key, list.length])),
    ),
  );
  if (unmapped.length) console.log(`Records without a mapped journey: ${unmapped.join(", ")}`);
}
