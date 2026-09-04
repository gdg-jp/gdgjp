#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { startDaemon } from "./index.ts";
import type { IndexEndpoint } from "./index.ts";
import { defaultEmbedder } from "./indexer/embed.ts";
import { DEFAULT_DATABASE_PATH, IndexStore } from "./indexer/store.ts";
import { IndexWatcher } from "./indexer/watcher.ts";

const USAGE =
  "Usage: agents-index watch --root <workdir> (--run-root <dir> [--slots <n>] " +
  "| --authz-socket <path> [--socket <path>]) [--db <path>]";

const args = process.argv.slice(2);
if (args[0] !== "watch") throw new Error(USAGE);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`);
  return next;
};
const root = value("--root");
if (!root) throw new Error("--root is required");
const databasePath = value("--db") ?? DEFAULT_DATABASE_PATH;
const runRoot = value("--run-root");
const authzSocketPath = value("--authz-socket");
if (runRoot && authzSocketPath)
  throw new Error("Use either --run-root or --authz-socket, not both");
if (!runRoot && !authzSocketPath) throw new Error("--run-root or --authz-socket is required");

const endpoints: IndexEndpoint[] = [];
if (runRoot) {
  const slotsRaw = value("--slots") ?? process.env.GDG_AGENT_SLOT_COUNT ?? "4";
  if (!/^[1-9]\d*$/.test(slotsRaw) || Number(slotsRaw) > 32) {
    throw new Error("--slots must be an integer from 1 to 32");
  }
  const slots = Number(slotsRaw);
  for (let slot = 0; slot < slots; slot += 1) {
    const dir = join(runRoot, String(slot));
    endpoints.push({
      socketPath: join(dir, "index.sock"),
      authzSocketPath: join(dir, "authz.sock"),
      socketGroup: `gdgagent-run-${slot}`,
    });
  }
} else {
  endpoints.push({
    socketPath: value("--socket") ?? process.env.AGENTS_INDEX_SOCKET ?? "/run/gdg-agent/index.sock",
    authzSocketPath: authzSocketPath as string,
  });
}

await mkdir(dirname(databasePath), { recursive: true });
const store = new IndexStore(databasePath);
const embedder = await defaultEmbedder();
const watcher = new IndexWatcher(root, store, embedder);
await watcher.start();
await startDaemon({
  endpoints,
  store,
  embedder,
  sourceMetadata: watcher.sourceMetadata,
});
