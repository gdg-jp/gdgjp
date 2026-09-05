#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  buf.write(`${mode.toString(8).padStart(6, "0")} \0`, 100, 8, "utf8");
  buf.write("000000 \0", 108, 8, "utf8");
  buf.write("000000 \0", 116, 8, "utf8");
  buf.write(`${size.toString(8).padStart(11, "0")} `, 124, 12, "utf8");
  buf.write("00000000000 ", 136, 12, "utf8");
  buf.fill(" ", 148, 156);
  buf.write(type, 156, 1, "utf8");
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");
  buf.write("root", 265, 4, "utf8");
  buf.write("root", 297, 4, "utf8");
  if (prefixField) {
    buf.write(prefixField, 345, 155, "utf8");
  }

  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += buf[i];
  }
  buf.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");

  return buf;
}

function buildTarArchive(entries) {
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const chunks = [];
  for (const entry of entries) {
    const header = createTarHeader(entry.relPath, entry.buffer.length, entry.mode || 0o644, "0");
    chunks.push(header);
    chunks.push(entry.buffer);

    const remainder = entry.buffer.length % 512;
    if (remainder > 0) {
      chunks.push(Buffer.alloc(512 - remainder));
    }
  }

  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function walkDir(dir, baseDir = dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      results.push(...(await walkDir(fullPath, baseDir)));
    } else if (entry.isFile()) {
      results.push({ fullPath, relPath });
    }
  }
  return results;
}

export function validateSpecForPublish(specPath, specContent, gdgBin) {
  let spec;
  try {
    spec = JSON.parse(specContent);
  } catch (err) {
    throw new Error(`Failed to parse spec at ${specPath}: ${err.message}`);
  }

  const env = spec.environment || "production";
  if (env === "development") {
    throw new Error(
      `spec with environment "development" cannot be published to production release`,
    );
  }

  if (gdgBin) {
    const res = spawnSync(
      gdgBin,
      ["agent-host", "validate-spec", "--for-release", "--spec", specPath],
      {
        encoding: "utf8",
      },
    );
    if (res.status !== 0) {
      throw new Error(`Release validation gate failed:\n${res.stderr || res.stdout}`);
    }
  }
}

export async function buildRelease({
  specPath = join(repositoryRoot, "agent-host/agent-host.json"),
  outDir,
  privateKey,
  version = "1.0.0",
  allowEphemeralKey = false,
  gdgBin,
}) {
  const specRaw = await readFile(specPath, "utf8");
  validateSpecForPublish(specPath, specRaw, gdgBin);

  const entriesMap = {};
  const archiveEntries = [];
  let uncompressedSize = 0;

  // 1. Include spec file
  const specBuffer = Buffer.from(specRaw, "utf8");
  const specHash = createHash("sha256").update(specBuffer).digest("hex");
  entriesMap["agent-host.json"] = specHash;
  uncompressedSize += specBuffer.length;
  archiveEntries.push({
    relPath: "agent-host.json",
    buffer: specBuffer,
    mode: 0o644,
  });

  // 2. Include config/ directory
  const configDir = join(dirname(specPath), "config");
  const configFiles = await walkDir(configDir, dirname(specPath));
  for (const file of configFiles) {
    const content = await readFile(file.fullPath);
    const hash = createHash("sha256").update(content).digest("hex");
    entriesMap[file.relPath] = hash;
    uncompressedSize += content.length;
    const fileStat = await stat(file.fullPath);
    archiveEntries.push({
      relPath: file.relPath,
      buffer: content,
      mode: fileStat.mode & 0o777 || 0o644,
    });
  }

  // 3. Include workspace/ directory
  const workspaceDir = join(dirname(specPath), "workspace");
  const workspaceFiles = await walkDir(workspaceDir, dirname(specPath));
  for (const file of workspaceFiles) {
    const content = await readFile(file.fullPath);
    const hash = createHash("sha256").update(content).digest("hex");
    entriesMap[file.relPath] = hash;
    uncompressedSize += content.length;
    const fileStat = await stat(file.fullPath);
    archiveEntries.push({
      relPath: file.relPath,
      buffer: content,
      mode: fileStat.mode & 0o777 || 0o644,
    });
  }

  const tarBuffer = buildTarArchive(archiveEntries);
  const tarGzBuffer = gzipSync(tarBuffer, { mtime: 0 });

  const archiveName = `agent-host-release-${version}.tar.gz`;
  const archiveHash = createHash("sha256").update(tarGzBuffer).digest("hex");

  const manifest = {
    version,
    type: "release",
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

  let privKeyObj;
  let pubKeyRaw;

  if (privateKey) {
    if (typeof privateKey === "string") {
      const trimmed = privateKey.trim();
      if (trimmed.length === 64) {
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
  const manifestPath = join(outDir, `agent-host-release-${version}.manifest.json`);
  const sigPath = join(outDir, `agent-host-release-${version}.manifest.json.sig`);

  await writeFile(archivePath, tarGzBuffer);
  await writeFile(manifestPath, manifestBytes);
  await writeFile(sigPath, sigHex, "utf8");

  return {
    archivePath,
    manifestPath,
    sigPath,
    manifest,
    publicKey: pubKeyRaw,
  };
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--spec" || arg === "-s") {
      options.specPath = args[++i];
    } else if (arg === "--out" || arg === "-o") {
      options.outDir = args[++i];
    } else if (arg === "--private-key" || arg === "-k") {
      options.privateKey = args[++i];
    } else if (arg === "--version" || arg === "-v") {
      options.version = args[++i];
    } else if (arg === "--gdg-bin") {
      options.gdgBin = args[++i];
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const specPath = options.specPath
      ? resolve(process.cwd(), options.specPath)
      : join(repositoryRoot, "agent-host/agent-host.json");
    const outDir = options.outDir
      ? resolve(process.cwd(), options.outDir)
      : join(repositoryRoot, "dist/agent-host-release");
    const privateKey = options.privateKey || process.env.AGENT_HOST_SIGNING_KEY;
    if (!privateKey) {
      console.error(
        "Error: Signing private key is required. Pass --private-key <key> or set AGENT_HOST_SIGNING_KEY environment variable.",
      );
      process.exit(1);
    }

    const res = await buildRelease({
      specPath,
      outDir,
      privateKey,
      version: options.version || "1.0.0",
      gdgBin: options.gdgBin,
    });

    console.log(`Release bundle created successfully:
  Archive:  ${res.archivePath}
  Manifest: ${res.manifestPath}
  Sig:      ${res.sigPath}`);
  } catch (err) {
    console.error("Error building agent-host release:", err.message);
    process.exit(1);
  }
}
