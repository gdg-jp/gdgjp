#!/usr/bin/env node
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// USTAR tar header builder
function createTarHeader(name, size, mode = 0o644, type = "0") {
  const buf = Buffer.alloc(512);

  let nameField = name;
  let prefixField = "";
  if (Buffer.byteLength(name, "utf8") > 100) {
    const idx = name.indexOf("/", name.length - 100);
    if (idx !== -1 && idx <= 155) {
      prefixField = name.slice(0, idx);
      nameField = name.slice(idx + 1);
    } else {
      throw new Error(`Path too long for tar header: ${name}`);
    }
  }

  buf.write(nameField, 0, 100, "utf8");
  buf.write(`${mode.toString(8).padStart(6, "0")} \0`, 100, 8, "utf8"); // mode
  buf.write("000000 \0", 108, 8, "utf8"); // uid
  buf.write("000000 \0", 116, 8, "utf8"); // gid
  buf.write(`${size.toString(8).padStart(11, "0")} `, 124, 12, "utf8"); // size
  buf.write("00000000000 ", 136, 12, "utf8"); // mtime (deterministic 0)
  buf.fill(" ", 148, 156); // checksum placeholder
  buf.write(type, 156, 1, "utf8"); // typeflag
  buf.write("ustar\0", 257, 6, "utf8"); // magic
  buf.write("00", 263, 2, "utf8"); // version
  buf.write("root", 265, 4, "utf8"); // uname
  buf.write("root", 297, 4, "utf8"); // gname
  if (prefixField) {
    buf.write(prefixField, 345, 155, "utf8");
  }

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += buf[i];
  }
  buf.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");

  return buf;
}

function buildTarArchive(entries) {
  // entries: array of { relPath, buffer, mode }
  // Sort entries for deterministic output
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const chunks = [];
  for (const entry of entries) {
    const header = createTarHeader(entry.relPath, entry.buffer.length, entry.mode || 0o644, "0");
    chunks.push(header);
    chunks.push(entry.buffer);

    // 512-byte padding for content
    const remainder = entry.buffer.length % 512;
    if (remainder > 0) {
      chunks.push(Buffer.alloc(512 - remainder));
    }
  }

  // Tar terminator: two 512-byte zero blocks
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function walkWorkspaceFiles(dir, baseDir = dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      results.push(...(await walkWorkspaceFiles(fullPath, baseDir)));
    } else if (entry.isFile()) {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

export async function buildBundle({
  workspaceDir,
  outDir,
  privateKey,
  version = "1.0.0",
  type = "workspace",
  allowEphemeralKey = false,
}) {
  const files = await walkWorkspaceFiles(workspaceDir);
  if (files.length === 0) {
    throw new Error(`No files found in workspace dir: ${workspaceDir}`);
  }

  const entriesMap = {};
  const archiveEntries = [];
  let uncompressedSize = 0;

  for (const file of files) {
    const rel = file.relPath;

    // Enforce Tier 1 boundary checks:
    // Only .agents/, .claude/, .codex/, and AGENTS.md are allowed.
    // Host configs (agent-host.json, config/, cli-config, sandbox, permissions) are strictly forbidden.
    const isAllowedTree =
      rel === "AGENTS.md" ||
      rel.startsWith(".agents/") ||
      rel.startsWith(".claude/") ||
      rel.startsWith(".codex/");
    if (!isAllowedTree) {
      throw new Error(`Tier 1 boundary violation: file outside allowed workspace subtrees: ${rel}`);
    }

    if (
      rel === "agent-host.json" ||
      rel.startsWith("config/") ||
      rel.includes("/config/") ||
      rel.endsWith("cli-config.json") ||
      rel.endsWith("sandbox.json") ||
      rel.endsWith("permissions.json")
    ) {
      throw new Error(
        `Tier 1 boundary violation: forbidden host execution config in workspace bundle: ${rel}`,
      );
    }

    const content = await readFile(file.fullPath);
    const hash = createHash("sha256").update(content).digest("hex");
    entriesMap[rel] = hash;
    uncompressedSize += content.length;

    const fileStat = await stat(file.fullPath);
    const mode = fileStat.mode & 0o777 || 0o644;
    archiveEntries.push({
      relPath: rel,
      buffer: content,
      mode,
    });
  }

  const tarBuffer = buildTarArchive(archiveEntries);
  const tarGzBuffer = gzipSync(tarBuffer, { mtime: 0 }); // deterministic gzip

  const archiveName = `agent-host-${type}-${version}.tar.gz`;
  const archiveHash = createHash("sha256").update(tarGzBuffer).digest("hex");

  const manifest = {
    version,
    type,
    archive: {
      name: archiveName,
      size: tarGzBuffer.length,
      sha256: archiveHash,
    },
    entries: entriesMap,
    entryCount: archiveEntries.length,
    uncompressedSize,
  };

  const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestBytes = Buffer.from(manifestRaw, "utf8");

  // Ed25519 signing
  let privKeyObj;
  let pubKeyRaw;

  if (privateKey) {
    if (typeof privateKey === "string") {
      const trimmed = privateKey.trim();
      if (trimmed.length === 64) {
        // 32-byte raw hex seed -> PKCS8 DER
        const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
        const seed = Buffer.from(trimmed, "hex");
        const der = Buffer.concat([pkcs8Prefix, seed]);
        privKeyObj = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      } else {
        privKeyObj = createPrivateKey(trimmed);
      }
    } else {
      privKeyObj = privateKey;
    }
  } else if (allowEphemeralKey) {
    // Generate an ephemeral keypair only if explicitly allowed (tests only)
    const pair = generateKeyPairSync("ed25519");
    privKeyObj = pair.privateKey;
    pubKeyRaw = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  } else {
    throw new Error(
      "Signing private key is required; pass privateKey or set allowEphemeralKey: true for test execution",
    );
  }

  const signature = sign(null, manifestBytes, privKeyObj);
  const sigHex = `${signature.toString("hex")}\n`;

  await mkdir(outDir, { recursive: true });

  const archivePath = join(outDir, archiveName);
  const manifestPath = join(outDir, `agent-host-${type}-${version}.manifest.json`);
  const sigPath = join(outDir, `agent-host-${type}-${version}.manifest.json.sig`);

  await writeFile(archivePath, tarGzBuffer);
  await writeFile(manifestPath, manifestBytes);
  await writeFile(sigPath, sigHex, "utf8");

  // Also produce unversioned stable bundle: agent-host-${type}.*
  const unversionedArchiveName = `agent-host-${type}.tar.gz`;
  const unversionedManifest = {
    ...manifest,
    archive: {
      ...manifest.archive,
      name: unversionedArchiveName,
    },
  };
  const unversionedManifestRaw = `${JSON.stringify(unversionedManifest, null, 2)}\n`;
  const unversionedManifestBytes = Buffer.from(unversionedManifestRaw, "utf8");
  const unversionedSig = sign(null, unversionedManifestBytes, privKeyObj);
  const unversionedSigHex = `${unversionedSig.toString("hex")}\n`;

  await writeFile(join(outDir, unversionedArchiveName), tarGzBuffer);
  await writeFile(join(outDir, `agent-host-${type}.manifest.json`), unversionedManifestBytes);
  await writeFile(join(outDir, `agent-host-${type}.manifest.json.sig`), unversionedSigHex, "utf8");

  return {
    archivePath,
    manifestPath,
    sigPath,
    manifest,
    publicKey: pubKeyRaw,
  };
}

// CLI entry point
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace" || arg === "-w") {
      options.workspaceDir = args[++i];
    } else if (arg === "--out" || arg === "-o") {
      options.outDir = args[++i];
    } else if (arg === "--private-key" || arg === "-k") {
      options.privateKey = args[++i];
    } else if (arg === "--version" || arg === "-v") {
      options.version = args[++i];
    } else if (arg === "--type" || arg === "-t") {
      options.type = args[++i];
    } else if (arg === "--pubkey-out") {
      options.pubkeyOut = args[++i];
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const workspaceDir = options.workspaceDir
      ? resolve(process.cwd(), options.workspaceDir)
      : join(repositoryRoot, "agent-host/workspace");
    const outDir = options.outDir
      ? resolve(process.cwd(), options.outDir)
      : join(repositoryRoot, "dist/agent-host-workspace");
    const privateKey = options.privateKey || process.env.AGENT_HOST_SIGNING_KEY;
    if (!privateKey) {
      console.error(
        "Error: Signing private key is required. Pass --private-key <key> or set AGENT_HOST_SIGNING_KEY environment variable.",
      );
      process.exit(1);
    }

    const res = await buildBundle({
      workspaceDir,
      outDir,
      privateKey,
      version: options.version || "1.0.0",
      type: options.type || "workspace",
    });

    if (options.pubkeyOut && res.publicKey) {
      await writeFile(options.pubkeyOut, `${res.publicKey.toString("hex")}\n`, "utf8");
    }

    console.log(`Bundle created successfully:
  Archive:  ${res.archivePath}
  Manifest: ${res.manifestPath}
  Sig:      ${res.sigPath}`);
  } catch (err) {
    console.error("Error building agent-host bundle:", err.message);
    process.exit(1);
  }
}
