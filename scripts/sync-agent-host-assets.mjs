#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(repositoryRoot, "cli/internal/agenthost/assets");
const configDest = join(destDir, "config");

const copies = [
  {
    src: join(repositoryRoot, "agents-index/src/proxy.ts"),
    dest: join(destDir, "index-proxy.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/hooks.json"),
    dest: join(configDest, "hooks.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/cli-config.json"),
    dest: join(configDest, "cli-config.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/sandbox.json.in"),
    dest: join(configDest, "sandbox.json.in"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/mcp.json.in"),
    dest: join(configDest, "mcp.json.in"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/permissions.json"),
    dest: join(configDest, "permissions.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/extra-mcp.json"),
    dest: join(configDest, "extra-mcp.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/spawn-slot.sh"),
    dest: join(configDest, "spawn-slot.sh"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/apparmor.d-cursor-agent-cursorsandbox"),
    dest: join(configDest, "apparmor.d-cursor-agent-cursorsandbox"),
  },
  {
    src: join(repositoryRoot, "agent-host/agent-host.json"),
    dest: join(destDir, "agent-host.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/package.json"),
    dest: join(destDir, "langfuse-forwarder/package.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/package-lock.json"),
    dest: join(destDir, "langfuse-forwarder/package-lock.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/tsconfig.json"),
    dest: join(destDir, "langfuse-forwarder/tsconfig.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/classify.ts"),
    dest: join(destDir, "langfuse-forwarder/src/classify.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/config.ts"),
    dest: join(destDir, "langfuse-forwarder/src/config.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/deterministic-ids.ts"),
    dest: join(destDir, "langfuse-forwarder/src/deterministic-ids.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/events.ts"),
    dest: join(destDir, "langfuse-forwarder/src/events.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/index.ts"),
    dest: join(destDir, "langfuse-forwarder/src/index.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/mask.ts"),
    dest: join(destDir, "langfuse-forwarder/src/mask.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/parse.ts"),
    dest: join(destDir, "langfuse-forwarder/src/parse.ts"),
  },
  {
    src: join(repositoryRoot, "agent-host/langfuse-forwarder/src/state.ts"),
    dest: join(destDir, "langfuse-forwarder/src/state.ts"),
  },
];

const checkOnly = process.argv.includes("--check");

async function main() {
  let mismatched = 0;
  for (const { src, dest } of copies) {
    const want = await readFile(src);
    if (checkOnly) {
      let have;
      try {
        have = await readFile(dest);
      } catch {
        console.error(`missing copied asset: ${dest}`);
        mismatched += 1;
        continue;
      }
      if (!want.equals(have)) {
        console.error(`asset drift: ${dest} does not match ${src}`);
        mismatched += 1;
      }
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, want);
  }
  if (checkOnly && mismatched > 0) {
    process.exit(1);
  }
}

await main();
