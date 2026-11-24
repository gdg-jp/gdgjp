import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOMBADIL, bombadilAsset, bombadilFailure, parseBombadilOutput } from "./bombadil.mjs";
import { applyMutation, loadMutations, verdict } from "./mutation-proof.mjs";

const output = readFileSync(new URL("./fixtures/bombadil-violation.log", import.meta.url), "utf8");

describe("bombadil", () => {
  it("pins one checksum per supported platform", () => {
    expect(BOMBADIL.version).toBe("0.8.0");
    expect(bombadilAsset("linux", "x64").url).toBe(
      "https://github.com/antithesishq/bombadil/releases/download/v0.8.0/bombadil-x86_64-linux",
    );
    for (const asset of Object.values(BOMBADIL.assets))
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => bombadilAsset("win32", "x64")).toThrow(/no binary/);
  });

  it("reads violations and the reproduce command from its output", () => {
    expect(parseBombadilOutput(output)).toEqual({
      violations: ["noUncaughtExceptions"],
      reproduce:
        "bombadil browser test 'file:///tmp/bombadil/page.html' --headless --reproduce /tmp/bombadil/trace.bin",
      inspect: "bombadil browser inspect /tmp/bombadil/trace.bin",
    });
    const failure = bombadilFailure({
      origin: "https://wiki.stg1.gdgs.jp",
      output,
      exitCode: 2,
      trace: "/tmp/bombadil/trace.bin",
    });
    expect(failure).toMatchObject({
      kind: "bombadil-violation",
      seed: null,
      title: "noUncaughtExceptions",
    });
    expect(failure.signature).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("mutation proof", () => {
  const directory = mkdtempSync(join(tmpdir(), "ui-property-mutation-"));
  const mutation = {
    id: "m",
    description: "d",
    workspace: "@gdgjp/x",
    spec: "e2e/ui-properties.spec.ts",
    file: "a.ts",
    find: "allowed = false",
    replace: "allowed = true",
    expect: { violation: "invariant:never widens" },
  };

  it("applies a mutation only when it matches exactly once", () => {
    writeFileSync(join(directory, "a.ts"), "const allowed = false;\n");
    applyMutation(directory, mutation);
    expect(readFileSync(join(directory, "a.ts"), "utf8")).toBe("const allowed = true;\n");
    expect(() => applyMutation(directory, mutation)).toThrow(/found 0/);
  });

  it("counts a mutant as killed only by a matching property failure", () => {
    const failure = { property: "p", violation: { kind: "invariant", name: "never widens" } };
    expect(verdict(mutation, 1, [failure])).toBe("killed");
    expect(verdict(mutation, 1, [])).toBe("failed-without-property-violation");
    expect(verdict(mutation, 1, [{ ...failure, violation: { kind: "monitor", name: "x" } }])).toBe(
      "failed-without-property-violation",
    );
    expect(verdict(mutation, 0, [])).toBe("survived");
  });

  it("validates every checked-in mutation file", () => {
    const names = readdirSync(new URL("../mutations/", import.meta.url))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5));
    expect(names).toContain("wiki");
    for (const name of names)
      expect(
        loadMutations(new URL(`../mutations/${name}.json`, import.meta.url).pathname).length,
      ).toBeGreaterThan(0);
  });
});
