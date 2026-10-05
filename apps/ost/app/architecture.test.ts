import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

it("keeps browser views, neutral board rules, auth and Worker runtime separated", () => {
  expect(existsSync(join(root, "app/lib"))).toBe(false);
  const violations: string[] = [];
  const featureFiles = files(join(root, "app/features"));
  expect(featureFiles.filter((path) => /\/pages\//.test(path))).toEqual([]);
  const routeFiles = files(join(root, "app/routes"));
  expect(routeFiles.filter((path) => path.includes("/_pages/"))).toEqual([]);
  for (const path of [
    ...featureFiles,
    ...routeFiles,
    ...files(join(root, "workers")),
    ...files(join(root, "app/layouts")),
    ...files(join(root, "app/components")),
  ]) {
    if (path.endsWith(".test.ts")) continue;
    const source = readFileSync(path, "utf8");
    const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    for (const specifier of imports) {
      const target = specifier.startsWith("~/")
        ? resolve(root, "app", specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(path), specifier)
          : specifier;
      const relative = path.slice(root.length + 1);
      const view =
        path.includes("/components/") ||
        path.includes("/layouts/") ||
        path.endsWith("use-live-board.ts");
      const neutral = /\/(protocol|scoring|assign|votes|geometry|slug|event)\.ts$/.test(path);
      const auth = path.includes("/features/auth/");
      const worker = path.includes("/workers/");
      if (
        (view && /(?:\.server|\/workers\/)/.test(target)) ||
        (path.includes("/features/") && /\/routes\//.test(target)) ||
        (view && /\/routes\//.test(target)) ||
        (path.includes("/app/components/") && /\/(features|layouts)\//.test(target)) ||
        (path.includes("/features/") &&
          path.includes("/components/") &&
          /\/(pages|layouts)\//.test(target)) ||
        (auth && /\/features\/(events|board|layout)\//.test(target)) ||
        ((neutral || worker) &&
          /(?:\.server|\/components\/|\/pages\/|\/layouts\/|\/routes\/|use-live-board)/.test(
            target,
          )) ||
        ((neutral || worker) && /^(react|react-dom|motion|radix-ui)(\/|$)/.test(target)) ||
        (neutral && target.startsWith("cloudflare:"))
      ) {
        violations.push(`${relative} -> ${specifier}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
