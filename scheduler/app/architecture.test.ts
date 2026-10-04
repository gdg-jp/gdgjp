import { describe, expect, it } from "vitest";

const libFiles = import.meta.glob("./lib/*", { query: "?raw", import: "default", eager: true });
const componentFiles = import.meta.glob("./components/*", {
  query: "?raw",
  import: "default",
  eager: true,
});
const featureSources = import.meta.glob<string>("./features/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});
const routeSources = import.meta.glob<string>("./routes/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});
const routeTable = import.meta.glob<string>("./routes.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("scheduler architecture", () => {
  it("keeps only cross-cutting primitives in lib and shell components outside features", () => {
    expect(
      Object.keys(libFiles)
        .map((path) => path.split("/").pop())
        .sort(),
    ).toEqual(["theme.tsx", "utils.ts"]);
    expect(
      Object.keys(componentFiles)
        .map((path) => path.split("/").pop())
        .sort(),
    ).toEqual(["gdg-mark.tsx", "share-url.tsx", "theme-toggle.tsx"]);
  });
  it("keeps feature modules independent of route adapters and client components independent of server code", () => {
    for (const [path, source] of Object.entries(featureSources).filter(
      ([path]) => !path.endsWith(".test.ts"),
    )) {
      expect(source, path).not.toMatch(/from\s+["'][^"']*(?:routes\/|\+types\/)/);
      expect(path).not.toMatch(/\/pages\//);
      if (path.includes("/components/")) {
        const runtimeImports = source.replace(/import type[\s\S]*?;/g, "");
        expect(runtimeImports, path).not.toMatch(/from\s+["'][^"']*\.server["']/);
      }
    }
    for (const [path, source] of Object.entries(routeSources)) {
      expect(source, path).not.toMatch(/\.prepare\(|\.batch\(/);
      expect(path).not.toMatch(/\/_pages\//);
    }
  });
  it("keeps primitives, domain widgets, pages and route binding separate", () => {
    for (const [path, source] of Object.entries(componentFiles)) {
      expect(source, path).not.toMatch(/from\s+["'][^"']*(?:features\/|layouts\/)/);
    }
    for (const [path, source] of Object.entries(featureSources)) {
      if (path.includes("/components/")) {
        expect(source, path).not.toMatch(/from\s+["'][^"']*(?:pages\/|layouts\/)/);
      }
    }
  });
  it("preserves public route paths", () => {
    const table = routeTable["./routes.ts"];
    expect([...table.matchAll(/route\("([^"\n]+)"/g)].map((match) => match[1])).toEqual([
      "events/new",
      "events",
      "e/:id",
      "e/:id/edit",
      "e/:id/delete",
      "signin",
      "api/auth/*",
      "auth/signout",
    ]);
    expect(table).toContain('index("routes/events/create.tsx")');
  });
});
