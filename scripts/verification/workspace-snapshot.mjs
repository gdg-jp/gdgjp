import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const excluded = new Set([
  ".git",
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  "node_modules",
  ".wrangler",
  ".turbo",
  ".react-router",
  ".next",
  ".open-next",
  ".vercel",
  "build",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  "storage-state",
  "local_data",
  ".npmrc",
]);

function included(file) {
  return !file
    .split(/[\\/]/)
    .some((part) => excluded.has(part) || part.startsWith(".dev.vars") || part.startsWith(".env"));
}

function git(directory, args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

function workspaceDirectories(root) {
  return ["apps", "packages"].flatMap((group) => {
    const path = join(root, group);
    if (!existsSync(path)) return [];
    return readdirSync(path).flatMap((name) => {
      const directory = join(path, name);
      const manifest = join(directory, "package.json");
      if (!existsSync(manifest)) return [];
      return [
        { path: relative(root, directory), manifest: JSON.parse(readFileSync(manifest, "utf8")) },
      ];
    });
  });
}

function linkDependencies(source, root, directory, local) {
  const from = join(source, directory, "node_modules");
  const to = join(root, directory, "node_modules");
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry.startsWith(".vite") || entry === ".cache") continue;
    if (entry.startsWith("@")) {
      mkdirSync(join(to, entry), { recursive: true });
      for (const name of readdirSync(join(from, entry))) {
        const path = join(from, entry, name);
        if (existsSync(path))
          symlinkSync(local.get(`${entry}/${name}`) ?? realpathSync(path), join(to, entry, name));
      }
    } else {
      const path = join(from, entry);
      if (existsSync(path)) symlinkSync(local.get(entry) ?? realpathSync(path), join(to, entry));
    }
  }
}

export function createWorkspaceSnapshot(sourceDirectory) {
  const source = realpathSync(resolve(sourceDirectory));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gdgjp-e2e-snapshot-")));
  const hashes = {};
  const revisions = {};
  function copyRepository(directory) {
    const prefix = relative(source, directory);
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" });
    if (revision.status === 0) revisions[prefix || "."] = revision.stdout.trim();
    const files = new Set(
      git(directory, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter(Boolean),
    );
    for (const file of files) {
      const name = join(prefix, file);
      if (!included(name)) continue;
      const from = join(source, name);
      if (!existsSync(from)) continue;
      const stat = lstatSync(from);
      if (stat.isDirectory()) {
        if (existsSync(join(from, ".git"))) copyRepository(from);
        continue;
      }
      const to = join(root, name);
      mkdirSync(dirname(to), { recursive: true });
      if (stat.isSymbolicLink()) {
        const target = realpathSync(from);
        const targetRelative = relative(source, target);
        if (
          isAbsolute(targetRelative) ||
          targetRelative === ".." ||
          targetRelative.startsWith(`..${sep}`)
        ) {
          throw new Error(`Source symlink escapes the checkout: ${name}`);
        }
        symlinkSync(relative(dirname(to), join(root, targetRelative)), to);
        hashes[name] = createHash("sha256").update(`symlink:${targetRelative}`).digest("hex");
      } else {
        copyFileSync(from, to);
        hashes[name] = createHash("sha256").update(readFileSync(to)).digest("hex");
      }
    }
    if (prefix && revisions[prefix]) {
      const metadata = join(root, prefix, ".git");
      mkdirSync(join(metadata, "objects"), { recursive: true });
      mkdirSync(join(metadata, "refs"), { recursive: true });
      writeFileSync(join(metadata, "HEAD"), `${revisions[prefix]}\n`);
    }
  }
  try {
    copyRepository(source);
    const workspaces = workspaceDirectories(root);
    const local = new Map(
      workspaces.map(({ path, manifest }) => [manifest.name, join(root, path)]),
    );
    for (const directory of ["", ...workspaces.map(({ path }) => path)])
      linkDependencies(source, root, directory, local);
    return {
      root,
      hashes,
      revisions,
      workspaces,
      dispose: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
