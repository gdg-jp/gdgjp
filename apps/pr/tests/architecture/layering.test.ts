import { describe, expect, it } from "vitest";
import { imports, read, sourceFiles } from "./files";

describe("layering", () => {
  it("features never import routes", () => {
    const offenders = sourceFiles("app/features").flatMap((f) =>
      imports(f)
        .filter((s) => s.startsWith("~/routes/"))
        .map((s) => `${f} → ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it("app/lib and app/components are domain-free", () => {
    const offenders = [...sourceFiles("app/lib"), ...sourceFiles("app/components")].flatMap((f) =>
      imports(f)
        .filter((s) => s.startsWith("~/features/") || s.startsWith("~/routes/"))
        .map((s) => `${f} → ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it("client components never import *.server modules", () => {
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
    const offenders = sourceFiles("app/routes").filter((f) => /\.prepare\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
