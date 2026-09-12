import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function parseApp(args) {
  const index = args.indexOf("--app");
  if (index === -1 || !args[index + 1])
    throw new Error("Usage: node scripts/check-locale-keys.mjs --app <app>");
  return args[index + 1];
}

function flatten(value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function sourceFor(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(sourceFor(path));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) result.push(readFileSync(path, "utf8"));
  }
  return result.join("\n");
}

try {
  const app = parseApp(process.argv.slice(2));
  const localeDirectory = join(root, app, "app", "locales");
  const sourceDirectory = join(root, app, "app");
  const allowPath = join(root, app, "locale-keys.allow.json");
  const allowed = existsSync(allowPath)
    ? (JSON.parse(readFileSync(allowPath, "utf8")).prefixes ?? [])
    : [];
  const source = sourceFor(sourceDirectory);
  const keys = new Set();
  for (const locale of readdirSync(localeDirectory)) {
    const path = join(localeDirectory, locale, "common.json");
    if (existsSync(path))
      for (const key of flatten(JSON.parse(readFileSync(path, "utf8")))) keys.add(key);
  }
  const unused = [...keys].filter((key) => {
    const singular = key.replace(/_(?:zero|one|two|few|many|other)$/, "");
    return (
      !source.includes(key) &&
      !source.includes(singular) &&
      !allowed.some((prefix) => key.startsWith(prefix))
    );
  });
  if (unused.length > 0) {
    for (const key of unused) console.error(`locale-key error: ${app}: unused ${key}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`locale-key error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
