import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gzipSync, zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BOMBADIL,
  bombadilAsset,
  bombadilFailure,
  cookieValue,
  parseBombadilOutput,
  redactOutput,
} from "./bombadil.mjs";
import { applyMutation, loadMutations, verdict } from "./mutation-proof.mjs";
import { needles, scanForSecrets, valuesFrom } from "./secret-scan.mjs";

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

function zip(entries) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = deflateRawSync(Buffer.from(content));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}

describe("secret scan", () => {
  const secret = "s3cr3t-access-value-0123456789";

  it("finds a secret in plain, encoded, compressed, and nested evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "secret-scan-"));
    const trace = zip([
      ["0-trace.network", `{"name":"cf-access-client-secret","value":"${secret}"}`],
    ]);
    writeFileSync(join(directory, "plain.txt"), `header ${secret}`);
    writeFileSync(join(directory, "trace.zip"), trace);
    writeFileSync(join(directory, "log.gz"), gzipSync(encodeURIComponent(`x=${secret}`)));
    writeFileSync(
      join(directory, "index.html"),
      `<script>window.r="data:application/zip;base64,${zip([["report.json", Buffer.from(`aa${secret}`).toString("base64")]]).toString("base64")}"</script>`,
    );
    writeFileSync(join(directory, "clean.txt"), "nothing to see");
    const findings = scanForSecrets([directory, join(directory, "missing")], { SECRET: secret }, [
      ["stdout", `${Buffer.from(`?${secret}`).toString("base64url")}`],
    ]);
    const locations = findings.map((finding) => finding.location.replace(directory, ""));
    expect(locations.sort()).toEqual(
      [
        "/index.html!embedded-zip!report.json",
        "/log.gz!gunzip",
        "/plain.txt",
        "/trace.zip!0-trace.network",
        "stdout",
      ].sort(),
    );
    expect(findings.every((finding) => finding.name === "SECRET")).toBe(true);
  });

  it("fails closed on unreadable archives and empty secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "secret-scan-"));
    writeFileSync(
      join(directory, "broken.zip"),
      Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(40)]),
    );
    expect(scanForSecrets([directory], { SECRET: secret })).toMatchObject([
      { name: "unreadable archive" },
    ]);
    expect(() => scanForSecrets([directory], { SECRET: "" })).toThrow(/empty/);
    expect(needles(secret)).toContain(secret);
  });

  it("decodes every zstd frame of a Bombadil trace and fails closed on a broken one", () => {
    const directory = mkdtempSync(join(tmpdir(), "secret-scan-"));
    const header = Buffer.from("BMBDTRC\u0000\u0001\u0000");
    writeFileSync(
      join(directory, "app.bin"),
      Buffer.concat([header, zstdCompressSync("{}"), zstdCompressSync(`{"cookie":"${secret}"}`)]),
    );
    const findings = scanForSecrets([directory], { SECRET: secret });
    expect(findings).toContainEqual({
      name: "SECRET",
      location: join(directory, "app.bin!frame-1"),
    });
    expect(findings.map((finding) => finding.location)).not.toContain(
      join(directory, "app.bin!frame-0"),
    );
    writeFileSync(
      join(directory, "app.bin"),
      Buffer.concat([header, zstdCompressSync("{}").subarray(0, 6)]),
    );
    expect(scanForSecrets([directory], { SECRET: secret })).toMatchObject([
      { name: "unreadable archive" },
    ]);
  });

  it("scans every value of a list and reads issued values from a file", () => {
    const directory = mkdtempSync(join(tmpdir(), "secret-scan-"));
    writeFileSync(join(directory, "values"), "first-jwt-value\n\nsecond-jwt-value\n");
    expect(valuesFrom(join(directory, "values"))).toEqual(["first-jwt-value", "second-jwt-value"]);
    expect(valuesFrom(join(directory, "missing"))).toEqual([]);
    writeFileSync(join(directory, "log.txt"), "cookie second-jwt-value");
    expect(
      scanForSecrets([join(directory, "log.txt")], {
        CF_Authorization: ["first-jwt-value", "second-jwt-value"],
      }),
    ).toHaveLength(1);
    expect(() => scanForSecrets([directory], { CF_Authorization: [] })).toThrow(/empty/);
  });
});

describe("bombadil redaction", () => {
  it("removes cookie and header values from what the wrapper prints and records", () => {
    const line = "CF_Authorization=eyJ.a.b; Path=/; Secure; HttpOnly";
    expect(cookieValue(line)).toBe("eyJ.a.b");
    expect(cookieValue("plain")).toBe("");
    const output = `Reproduce this test using:\n  bombadil browser test 'https://x' --cookie ${line} --header CF-Access-Client-Secret=s3cret-v\nurl=${encodeURIComponent("eyJ.a.b")}`;
    const redacted = redactOutput(output, ["eyJ.a.b", "s3cret-v", ""]);
    expect(redacted).not.toMatch(/eyJ\.a\.b|s3cret-v/);
    expect(parseBombadilOutput(redacted).reproduce).toContain(
      "--cookie CF_Authorization=[redacted]",
    );
  });
});
