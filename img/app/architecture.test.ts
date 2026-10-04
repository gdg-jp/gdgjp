import { describe, expect, it } from "vitest";
import routes from "./routes";

const modules = import.meta.glob<string>(
  ["./**/*.ts", "./**/*.tsx", "!./**/*.test.ts", "!./**/*.test.tsx"],
  { eager: true, query: "?raw", import: "default" },
);
const sources = Object.keys(modules).map((path) => path.slice(2));

function imports(file: string) {
  const source = modules[`./${file}`];
  return [...source.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)].map(
    ([, type, names, target]) => ({
      target,
      typeOnly:
        Boolean(type) ||
        (names.startsWith("{") &&
          names
            .slice(1, names.lastIndexOf("}"))
            .split(",")
            .filter((name) => name.trim())
            .every((name) => name.trim().startsWith("type "))),
    }),
  );
}

function localModule(file: string, target: string): string | undefined {
  const path = target.startsWith("~/")
    ? target.slice(2)
    : target.startsWith(".")
      ? new URL(target, `https://architecture.test/${file}`).pathname.slice(1)
      : undefined;
  return path === undefined
    ? undefined
    : sources.find((file) => file === `${path}.ts` || file === `${path}.tsx`);
}

describe("architecture boundaries", () => {
  it("keeps lib and components domain-free", () => {
    expect(sources.filter((path) => path.startsWith("lib/")).sort()).toEqual([
      "lib/http-cache.ts",
      "lib/utils.ts",
    ]);
    expect(
      sources.filter(
        (path) => path.startsWith("components/") && !path.startsWith("components/ui/"),
      ),
    ).toEqual([]);
    expect(sources.filter((path) => path.startsWith("layouts/")).sort()).toEqual([
      "layouts/page-shell.tsx",
      "layouts/top-bar.tsx",
    ]);
  });

  it("keeps composed screens under routes and application data inside features", () => {
    expect(sources.filter((file) => /^features\/[^/]+\/pages\//.test(file))).toEqual([]);
    expect(sources.filter((file) => file.includes("/_pages/"))).toEqual([]);
    expect(
      sources.filter((file) => file.startsWith("routes/") && file.includes(".server.")),
    ).toEqual([]);
  });

  it("preserves feature direction and client/server boundaries", () => {
    for (const file of sources) {
      for (const { target, typeOnly } of imports(file)) {
        const dependency = localModule(file, target);
        if (!dependency) continue;
        if (file.startsWith("features/")) {
          expect(dependency, `${file} imports a route`).not.toMatch(/^routes(?:\/|\.)/);
        }
        if (file.startsWith("components/")) {
          expect(dependency, `${file} contains app composition`).not.toMatch(
            /^(features|layouts|routes)\//,
          );
        }
        if (file.includes("/components/")) {
          expect(dependency, `${file} depends on route composition`).not.toMatch(
            /^routes(?:\/|\.)/,
          );
        }
        if (file.startsWith("routes/")) {
          expect(dependency, `${file} forwards to another route module`).not.toMatch(/^routes\//);
        }
        if (file.startsWith("features/auth/")) {
          expect(dependency, `${file} depends on a resource feature`).not.toMatch(
            /^features\/(images|folders)\//,
          );
        }
        if (file.startsWith("features/folders/")) {
          expect(dependency, `${file} reverses the image-to-folder direction`).not.toMatch(
            /^features\/images\//,
          );
        }
        if (file.startsWith("lib/")) {
          expect(dependency, `${file} contains domain coupling`).not.toMatch(
            /^(features|routes|components)\//,
          );
        }
        if (
          (file.startsWith("components/") ||
            file.startsWith("layouts/") ||
            file.includes("/components/")) &&
          !typeOnly
        ) {
          expect(dependency, `${file} imports server runtime code`).not.toContain(".server.");
        }
      }
    }
  });

  it("has no runtime import cycles", () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(file: string, chain: string[]) {
      expect(visiting.has(file), `Import cycle: ${[...chain, file].join(" -> ")}`).toBe(false);
      if (visited.has(file)) return;
      visiting.add(file);
      for (const { target, typeOnly } of imports(file)) {
        const dependency = localModule(file, target);
        if (dependency && !typeOnly) visit(dependency, [...chain, file]);
      }
      visiting.delete(file);
      visited.add(file);
    }
    for (const file of sources) visit(file, []);
  });

  it("preserves registered public URLs", () => {
    expect(routes.map((route) => (route.index ? "(index)" : route.path)).sort()).toEqual(
      [
        "(index)",
        ":id",
        "api/auth/*",
        "api/cli/v1/folders",
        "api/cli/v1/folders/:id",
        "api/cli/v1/images",
        "api/cli/v1/images/:id",
        "api/cli/v1/images/:id/mobile",
        "api/delete/:id",
        "api/folders",
        "api/folders/:id",
        "api/internal/upload",
        "api/mobile/:id",
        "api/move/:id",
        "api/replace/:id",
        "api/share/:id",
        "api/slug/:id",
        "api/upload",
        "auth/signout",
        "i/:id",
        "no-chapter",
        "signin",
      ].sort(),
    );
  });
});
