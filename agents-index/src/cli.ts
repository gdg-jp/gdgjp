#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { startDaemon } from "./index.ts";
import { defaultEmbedder } from "./indexer/embed.ts";
import { DEFAULT_DATABASE_PATH, IndexStore } from "./indexer/store.ts";
import { IndexWatcher } from "./indexer/watcher.ts";

const args = process.argv.slice(2);
if (args[0] !== "watch")
  throw new Error(
    "Usage: agents-index watch --root <workdir> --authz-socket <path> [--db <path>] [--socket <path>]",
  );
const value = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
const root = value("--root");
if (!root) throw new Error("--root is required");
const databasePath = value("--db") ?? DEFAULT_DATABASE_PATH;
const socketPath =
  value("--socket") ?? process.env.AGENTS_INDEX_SOCKET ?? "/run/gdg-agent/index.sock";
const authzSocketPath = value("--authz-socket");
if (!authzSocketPath) throw new Error("--authz-socket is required");
await mkdir(dirname(databasePath), { recursive: true });
const store = new IndexStore(databasePath);
const embedder = await defaultEmbedder();
const watcher = new IndexWatcher(root, store, embedder);
await watcher.start();
await startDaemon({
  socketPath,
  authzSocketPath,
  store,
  embedder,
  sourceMetadata: watcher.sourceMetadata,
});
