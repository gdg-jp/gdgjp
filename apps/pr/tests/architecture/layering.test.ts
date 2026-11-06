import { describe, expect, it } from "vitest";
import { imports, read, sourceFiles } from "./files";

describe("layering", () => {
  it("features never import routes", () => {
    // Routes compose features; the other direction makes a cycle and hides screen logic in domains.
    const offenders = sourceFiles("app/features").flatMap((f) =>
      imports(f)
        .filter((s) => s.startsWith("~/routes/"))
        .map((s) => `${f} → ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it("app/lib and app/components are domain-free", () => {
    // They are primitives: a feature import would make them un-reusable.
    const offenders = [...sourceFiles("app/lib"), ...sourceFiles("app/components")].flatMap((f) =>
      imports(f)
        .filter((s) => s.startsWith("~/features/") || s.startsWith("~/routes/"))
        .map((s) => `${f} → ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it("client components never import *.server modules", () => {
    // Widgets ship to the browser; a server import would bundle secrets or D1 code.
    const offenders = [
      ...sourceFiles("app/components"),
      ...sourceFiles("app/features"),
      ...sourceFiles("app/layouts"),
    ]
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) =>
        [...read(f).matchAll(/import\s+(?!type\b)[^;]*?from\s+["']([^"']+\.server)["']/g)].map(
          (m) => `${f} → ${m[1]}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("features own SQL", () => {
    // SQL in a route bypasses the repository that the tests cover.
    const offenders = sourceFiles("app/routes").filter((f) => /\.prepare\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
