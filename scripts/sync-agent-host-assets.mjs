#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
    src: join(repositoryRoot, "agent-host/config/backends/cursor/hooks.json"),
    dest: join(configDest, "backends/cursor/hooks.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/backends/cursor/cli-config.json"),
    dest: join(configDest, "backends/cursor/cli-config.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/backends/cursor/sandbox.json.in"),
    dest: join(configDest, "backends/cursor/sandbox.json.in"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/backends/cursor/mcp.json.in"),
    dest: join(configDest, "backends/cursor/mcp.json.in"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/backends/cursor/permissions.json"),
    dest: join(configDest, "backends/cursor/permissions.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/backends/antigravity/README.md"),
    dest: join(configDest, "backends/antigravity/README.md"),
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
    src: join(repositoryRoot, "agent-host/config/release-key.pub"),
    dest: join(configDest, "release-key.pub"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/systemd/agent-host-sync.service"),
    dest: join(configDest, "systemd/agent-host-sync.service"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/systemd/agent-host-sync.timer"),
    dest: join(configDest, "systemd/agent-host-sync.timer"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/systemd/agent-host-apply.service"),
    dest: join(configDest, "systemd/agent-host-apply.service"),
  },
  {
    src: join(repositoryRoot, "agent-host/config/systemd/agent-host-apply.timer"),
    dest: join(configDest, "systemd/agent-host-apply.timer"),
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
  // agents-index daemon: standalone runtime manifest (source of truth is
  // agent-host/agents-index/). The daemon sources themselves are mirrored
  // recursively from the @gdgjp/agents-index workspace package below, so that
  // directory stays the single source of truth. The ACL import rewrite and the
  // vendored acl bundle are applied by gdg agent-host apply at emit time, not
  // here, so the copied sources stay byte-identical to the workspace package.
  {
    src: join(repositoryRoot, "agent-host/agents-index/package.json"),
    dest: join(destDir, "agents-index/package.json"),
  },
  {
    src: join(repositoryRoot, "agent-host/agents-index/package-lock.json"),
    dest: join(destDir, "agents-index/package-lock.json"),
  },
];

// Whole subtrees mirrored file-for-file, including deletions, so a newly added
// or removed source cannot silently pass `--check` and then break the deployed
// daemon with a missing module.
const mirrors = [
  {
    srcDir: join(repositoryRoot, "agents-index/src"),
    destDir: join(destDir, "agents-index/src"),
    match: (name) => name.endsWith(".ts"),
  },
];

const checkOnly = process.argv.includes("--check");

async function walkFiles(root, match, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(root, match, rel)));
    } else if (entry.isFile() && match(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

async function main() {
  let mismatched = 0;

  const pairs = [...copies];
  for (const mirror of mirrors) {
    for (const rel of await walkFiles(mirror.srcDir, mirror.match)) {
      pairs.push({ src: join(mirror.srcDir, rel), dest: join(mirror.destDir, rel) });
    }
  }

  for (const { src, dest } of pairs) {
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

  // Reconcile deletions: any mirrored file whose source is gone must not linger.
  for (const mirror of mirrors) {
    const wanted = new Set(await walkFiles(mirror.srcDir, mirror.match));
    for (const rel of await walkFiles(mirror.destDir, () => true)) {
      if (wanted.has(rel)) continue;
      const stale = join(mirror.destDir, rel);
      if (checkOnly) {
        console.error(
          `stale mirrored asset: ${stale} has no counterpart in ${relative(repositoryRoot, mirror.srcDir)}`,
        );
        mismatched += 1;
      } else {
        await rm(stale);
      }
    }
  }

  if (checkOnly && mismatched > 0) {
    process.exit(1);
  }
}

await main();
