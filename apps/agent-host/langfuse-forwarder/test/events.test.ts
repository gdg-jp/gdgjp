import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSessionLogs, readEventLines } from "../src/events.js";

/**
 * Layout contract: this must scan exactly DATA_DIR/logs/observability/*.jsonl —
 * the same literal path xangi's src/observability-logger.ts writes to once
 * initObservabilityLogger(DATA_DIR) is active. A real integration check once
 * caught these drifting (writer used DATA_DIR/observability, no 'logs'
 * segment), which silently made the forwarder scan an empty directory in
 * production and forward nothing.
 */
describe("discoverSessionLogs layout contract", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "events-layout-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("finds session logs under DATA_DIR/logs/observability/*.jsonl", () => {
    const dir = join(dataDir, "logs", "observability");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session-a.jsonl"), '{"schemaVersion":1}\n');

    const found = discoverSessionLogs(dataDir);
    expect(found).toEqual([{ appSessionId: "session-a", filePath: join(dir, "session-a.jsonl") }]);
  });

  it('does NOT find files written directly under DATA_DIR/observability (missing "logs" segment)', () => {
    const wrongDir = join(dataDir, "observability");
    mkdirSync(wrongDir, { recursive: true });
    writeFileSync(join(wrongDir, "session-a.jsonl"), '{"schemaVersion":1}\n');

    expect(discoverSessionLogs(dataDir)).toEqual([]);
  });

  it("returns an empty array when the directory does not exist yet", () => {
    expect(discoverSessionLogs(dataDir)).toEqual([]);
  });

  it("ignores non-.jsonl files", () => {
    const dir = join(dataDir, "logs", "observability");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "not a session log");
    writeFileSync(join(dir, "session-a.jsonl"), "{}\n");

    const found = discoverSessionLogs(dataDir);
    expect(found).toHaveLength(1);
    expect(found[0].appSessionId).toBe("session-a");
  });
});

describe("readEventLines", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "events-lines-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("splits into non-empty lines and drops trailing blank lines", () => {
    const filePath = join(dataDir, "session.jsonl");
    writeFileSync(filePath, '{"a":1}\n{"b":2}\n\n');
    expect(readEventLines(filePath)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("returns an empty array for a missing file", () => {
    expect(readEventLines(join(dataDir, "missing.jsonl"))).toEqual([]);
  });
});
