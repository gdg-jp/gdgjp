import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DiscoveredSessionLog {
  appSessionId: string;
  filePath: string;
}

/**
 * Finds every xangi observability log under DATA_DIR/logs/observability/*.jsonl.
 * Mirrors xangi's own `logs/observability/<appSessionId>.jsonl` layout
 * (see ~/proj/xangi/src/observability-logger.ts) — this consumer does not write
 * to these files, only reads them.
 */
export function discoverSessionLogs(dataDir: string): DiscoveredSessionLog[] {
  const dir = join(dataDir, "logs", "observability");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      appSessionId: name.slice(0, -".jsonl".length),
      filePath: join(dir, name),
    }));
}

/** Reads a session's JSONL file as an array of non-empty raw lines. */
export function readEventLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}
