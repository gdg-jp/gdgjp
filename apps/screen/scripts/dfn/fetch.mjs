#!/usr/bin/env node
// Puts the DeepFilterNet3 noise-suppression assets into public/dfn/<version>/
// before a build or dev server: downloaded from the `screen-dfn/<version>`
// GitHub Release (made by build.sh) and checked against the hashes below.
// Files that already match are left alone.
//
//   node scripts/dfn/fetch.mjs              # from the release
//   node scripts/dfn/fetch.mjs --from DIR   # from a local build.sh output
//   node scripts/dfn/fetch.mjs --strict     # fail instead of warning (build)
//
// Without the assets the app still works (mics fall back to the browser's
// own noise suppression), so dev only warns; `build` is strict so a deploy
// never ships without them.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bump together with DFN_BASE in app/features/rtc/denoise/engine.ts.
const VERSION = "v1";
const RELEASE = `https://github.com/gdg-jp/gdgjp/releases/download/screen-dfn/${VERSION}`;
// Release file → [served name, sha256]. The model is served as .bin: servers
// (Vite's among them) send a .tar.gz with `Content-Encoding: gzip`, so the
// browser would hand the wasm an already-unpacked tar.
const FILES = {
  "df_bg.wasm": ["df_bg.wasm", "7d5b36f82972941ef98b988cb2f5bdbad17201750a47c17f8df348fe7d4cadaf"],
  "DeepFilterNet3_onnx.tar.gz": [
    "model.bin",
    "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616",
  ],
};

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "public/dfn", VERSION);
const fromIdx = process.argv.indexOf("--from");
const from = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function hashOf(path) {
  try {
    return sha256(await readFile(path));
  } catch {
    return null;
  }
}

async function fetchOne(name, served, expected) {
  const dest = join(out, served);
  if ((await hashOf(dest)) === expected) return;
  let buf;
  if (from) {
    await copyFile(join(from, name), `${dest}.part`);
    buf = await readFile(`${dest}.part`);
  } else {
    const res = await fetch(`${RELEASE}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(`${dest}.part`, buf);
  }
  const actual = sha256(buf);
  if (actual !== expected) throw new Error(`${name}: sha256 ${actual}, expected ${expected}`);
  await rename(`${dest}.part`, dest);
  console.log(`dfn: ${served} ready`);
}

try {
  await mkdir(out, { recursive: true });
  for (const [name, [served, hash]] of Object.entries(FILES)) await fetchOne(name, served, hash);
} catch (err) {
  console.error(`dfn: ${err instanceof Error ? err.message : err}`);
  if (process.argv.includes("--strict")) process.exit(1);
  console.error("dfn: continuing without noise suppression assets");
}
