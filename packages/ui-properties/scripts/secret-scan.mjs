import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync, zstdDecompressSync } from "node:zlib";

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GZIP = Buffer.from([0x1f, 0x8b]);
const ZSTD = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const BOMBADIL_TRACE = Buffer.from("BMBDTRC");

function zstdFrame(buffer, start) {
  const descriptor = buffer[start + 4];
  if (descriptor === undefined) throw new Error(`zstd frame at ${start} is truncated`);
  const single = (descriptor >> 5) & 1;
  const sizeBytes = [single, 2, 4, 8][descriptor >> 6];
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
  let cursor = start + 5 + (single ? 0 : 1) + dictionaryBytes;
  let declared = null;
  if (sizeBytes) {
    if (cursor + sizeBytes > buffer.length) throw new Error(`zstd frame at ${start} is truncated`);
    declared = Number(buffer.readUIntLE(cursor, Math.min(sizeBytes, 6)));
    if (sizeBytes === 2) declared += 256;
    cursor += sizeBytes;
  }
  for (;;) {
    if (cursor + 3 > buffer.length) throw new Error(`zstd frame at ${start} is truncated`);
    const header = buffer.readUIntLE(cursor, 3);
    const type = (header >> 1) & 3;
    if (type === 3) throw new Error(`zstd frame at ${start} has a reserved block`);
    cursor += 3 + (type === 1 ? 1 : header >> 3);
    if (cursor > buffer.length) throw new Error(`zstd frame at ${start} is truncated`);
    if (header & 1) break;
  }
  if ((descriptor >> 2) & 1) cursor += 4;
  if (cursor > buffer.length) throw new Error(`zstd frame at ${start} is truncated`);
  const data = zstdDecompressSync(buffer.subarray(start, cursor));
  if (declared !== null && sizeBytes < 8 && data.length !== declared)
    throw new Error(`zstd frame at ${start} decoded to ${data.length} of ${declared} bytes`);
  return { end: cursor, data };
}

function zstdFrames(buffer) {
  const frames = [];
  let covered = 0;
  for (let index = buffer.indexOf(ZSTD); index >= 0; index = buffer.indexOf(ZSTD, index + 1)) {
    if (index < covered) continue;
    const frame = zstdFrame(buffer, index);
    frames.push(frame.data);
    covered = frame.end;
  }
  if (!frames.length) throw new Error("a Bombadil trace without zstd frames");
  return frames;
}
const EMBEDDED_ZIP = /data:application\/zip;base64,([A-Za-z0-9+/=]+)/g;

export function needles(secret) {
  const bytes = Buffer.from(secret);
  const found = new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]);
  for (let offset = 0; offset < 3; offset++) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    const start = Math.ceil((offset * 8) / 6);
    const end = Math.floor(((offset + bytes.length) * 8) / 6);
    const core = encoded.slice(start, end);
    if (core.length >= 8) {
      found.add(core);
      found.add(core.replaceAll("+", "-").replaceAll("/", "_"));
    }
  }
  return [...found].filter((value) => value.length >= 4);
}

export function zipEntries(buffer) {
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index--)
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  if (end < 0) throw new Error("no zip directory");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let entry = 0; entry < count; entry++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("bad zip directory entry");
    const method = buffer.readUInt16LE(cursor + 10);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (size === 0xffffffff || local === 0xffffffff) throw new Error("zip64 is not supported");
    const dataStart =
      local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + size);
    if (method !== 0 && method !== 8) throw new Error(`zip method ${method} is not supported`);
    entries.push({ name, data: method === 8 ? inflateRawSync(data) : data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function scanBuffer(buffer, label, secrets, findings, depth = 0) {
  for (const [name, values] of secrets)
    if (values.some((value) => buffer.includes(value))) findings.push({ name, location: label });
  if (depth > 4) return;
  const nested = [];
  try {
    if (buffer.subarray(0, 4).equals(ZIP))
      for (const entry of zipEntries(buffer)) nested.push([entry.data, `${label}!${entry.name}`]);
    else if (buffer.subarray(0, 2).equals(GZIP))
      nested.push([gunzipSync(buffer), `${label}!gunzip`]);
    else if (buffer.subarray(0, 4).equals(ZSTD))
      nested.push([zstdFrame(buffer, 0).data, `${label}!zstd`]);
    else if (buffer.subarray(0, BOMBADIL_TRACE.length).equals(BOMBADIL_TRACE))
      zstdFrames(buffer).forEach((frame, index) => {
        nested.push([frame, `${label}!frame-${index}`]);
      });
  } catch (error) {
    findings.push({ name: "unreadable archive", location: `${label}: ${error.message}` });
  }
  if (buffer.length < 64 * 1024 * 1024)
    for (const match of buffer.toString("latin1").matchAll(EMBEDDED_ZIP))
      nested.push([Buffer.from(match[1], "base64"), `${label}!embedded-zip`]);
  for (const [data, where] of nested) scanBuffer(data, where, secrets, findings, depth + 1);
}

function files(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true })
    .map((name) => join(path, String(name)))
    .filter((file) => statSync(file).isFile());
}

export function scanForSecrets(paths, secrets, texts = []) {
  const prepared = Object.entries(secrets).map(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || values.some((item) => !item))
      throw new Error(`${name} is empty; there is nothing to scan for`);
    return [name, values.flatMap(needles)];
  });
  const findings = [];
  for (const path of paths)
    for (const file of files(path)) scanBuffer(readFileSync(file), file, prepared, findings);
  for (const [label, text] of texts) scanBuffer(Buffer.from(text), label, prepared, findings);
  return findings;
}

export function valuesFrom(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function main(args) {
  const names = [];
  const lists = [];
  const paths = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--env") names.push(args[++index]);
    else if (args[index] === "--values") {
      const [name, file] = String(args[++index]).split(/=(.*)/s);
      if (!name || !file) throw new Error("--values needs NAME=FILE");
      lists.push([name, valuesFrom(file)]);
    } else paths.push(args[index]);
  }
  if (!names.length || !paths.length)
    throw new Error("Usage: node secret-scan.mjs --env NAME... [--values NAME=FILE]... PATH...");
  const findings = scanForSecrets(paths, {
    ...Object.fromEntries(names.map((name) => [name, process.env[name]])),
    ...Object.fromEntries(lists.filter(([, values]) => values.length)),
  });
  for (const finding of findings) console.error(`${finding.name} found in ${finding.location}`);
  if (findings.length) process.exitCode = 1;
  else console.log(`No secrets found in ${paths.length} path(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
