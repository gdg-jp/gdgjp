import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(path) && !path.endsWith(".test.ts")
        ? [path]
        : [];
  });
}

it("keeps feature dependencies acyclic and independent of HTTP adapters", () => {
  const graph = new Map<string, string[]>();
  for (const file of sources(join(app, "features"))) {
    const dependencies = ts
      .preProcessFile(readFileSync(file, "utf8"), true)
      .importedFiles.map(({ fileName }) => fileName);
    expect(
      dependencies.filter((path) => path.includes("/routes/") || path.includes("/lib/")),
      file,
    ).toEqual([]);
    graph.set(
      file,
      dependencies
        .filter((path) => path.startsWith(".") || path.startsWith("~/"))
        .map((path) => {
          const base = path.startsWith("~/")
            ? resolve(app, path.slice(2))
            : resolve(dirname(file), path);
          return `${base}.ts`;
        }),
    );
  }
  function visit(file: string, trail: string[]) {
    expect(trail, `dependency cycle: ${[...trail, file].join(" -> ")}`).not.toContain(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...trail, file]);
  }
  for (const file of graph.keys()) visit(file, []);
  expect(existsSync(join(app, "lib"))).toBe(false);
  const repository = readFileSync(join(app, "features/jobs/job-repository.server.ts"), "utf8");
  expect(ts.preProcessFile(repository, true).importedFiles.map(({ fileName }) => fileName)).toEqual(
    ["nanoid", "./job-types"],
  );
  const fields = readFileSync(join(app, "features/connpass/event-fields.ts"), "utf8");
  expect(ts.preProcessFile(fields, true).importedFiles).toEqual([]);
});

it("preserves the public route set and resolves every relocated adapter", () => {
  const registration = readFileSync(join(app, "routes.ts"), "utf8");
  const routes = [...registration.matchAll(/route\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)];
  expect(routes.map((match) => match[1])).toEqual([
    "api/jobs/:jobId",
    "api/groups/:groupId/events",
    "api/groups/:groupId/events/:eventId",
    ...[
      "publish",
      "image",
      "copy",
      "cancel",
      "participants",
      "participants/:participantId",
      "stats",
      "messages",
      "vouchers",
      "vouchers/:voucherId",
      "sub-events",
      "sub-events/:subEventId",
      "survey",
      "conference",
    ].map((suffix) => `api/groups/:groupId/events/:eventId/${suffix}`),
    "api/admin/session/relogin",
    "api/admin/groups",
    "api/admin/groups/:groupId",
  ]);
  for (const match of routes) expect(existsSync(join(app, match[2])), match[2]).toBe(true);
});
