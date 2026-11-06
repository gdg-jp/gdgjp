import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function sourceFiles(dir: string, { tests = false } = {}): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "+types")
          walk(`${rel}/${entry.name}`);
      } else if (/\.tsx?$/.test(entry.name) && (tests || !/\.test\.tsx?$/.test(entry.name))) {
        out.push(`${rel}/${entry.name}`);
      }
    }
  };
  walk(dir);
  return out;
}

export const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

export function imports(rel: string): string[] {
  return [...read(rel).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (m) => m[1] as string,
  );
}
