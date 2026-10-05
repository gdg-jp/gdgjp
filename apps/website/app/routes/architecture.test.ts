import { describe, expect, it } from "vitest";

const features = import.meta.glob("../features/**/*.{ts,tsx}");
const routes = import.meta.glob("./**/*.{ts,tsx}");
const reusableModules = import.meta.glob(
  ["../components/**/*.{ts,tsx}", "../features/**/*.{ts,tsx}", "../layouts/**/*.{ts,tsx}"],
  { eager: true, query: "?raw", import: "default" },
);

describe("website composition boundaries", () => {
  it("keeps page composition outside features", () => {
    expect(Object.keys(features).filter((path) => /\/(pages|_pages)\//.test(path))).toEqual([]);
    expect(Object.keys(routes).filter((path) => path.includes("/_pages/"))).toEqual([]);
  });

  it("keeps reusable components and features independent of routes", () => {
    const routesDirectory = new URL("./", import.meta.url).href;

    for (const [path, source] of Object.entries(reusableModules)) {
      for (const match of String(source).matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
        const specifier = match[1];
        const resolved = specifier.startsWith("~/")
          ? new URL(`../${specifier.slice(2)}`, import.meta.url).href
          : specifier.startsWith(".")
            ? new URL(specifier, new URL(path, import.meta.url)).href
            : specifier;

        expect(resolved.startsWith(routesDirectory), `${path} imports ${specifier}`).toBe(false);
      }
    }
  });
});
