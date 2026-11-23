#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { align, fixNotation, splitPhrases } from "../app/features/clips/align.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const audioDir = join(root, "音声");
const scriptDir = join(root, "原稿");
const outAudioDir = join(root, "public", "audio");
const outJson = join(root, "app", "features", "clips", "clips.json");
const overridesPath = join(root, "scripts", "overrides.json");

const TRACKS = ["A", "B", "C", "D"];
const LOOP_DEFAULT = new Set(["A-01"]);
const COMMON = [
  { file: "登壇準備中", n: 1 },
  { file: "オンライン接続確認", n: 2 },
  { file: "機材調整中", n: 3 },
  { file: "まもなく開始", n: 4 },
];

const force = process.argv.includes("--force");

function cleanLine(line) {
  return line
    .replace(/\\(.)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^[>\s#-]+/, "")
    .trim();
}

function cleanTitle(raw) {
  let title = cleanLine(raw).replace(/^【[^】]*】|^\[[^\]]*\]/, "");
  for (;;) {
    const next = title.replace(/\s*[（(][^（()）]*[)）]\s*$/, "");
    if (next === title) break;
    title = next;
  }
  return title.replace(/\s+/g, " ").trim();
}

function parseSections(md, markerRe) {
  const sections = new Map();
  let current = null;
  for (const rawLine of md.split("\n")) {
    const line = rawLine.replace(/\\/g, "");
    const m = line.match(markerRe);
    if (m) {
      current = { key: m[1], title: cleanTitle(rawLine), lines: [] };
      sections.set(current.key, current);
      continue;
    }
    if (!current) continue;
    if (/^#{1,3}\s/.test(rawLine) || /^#{1,3}\s*$/.test(rawLine)) {
      current = null;
      continue;
    }
    const text = cleanLine(rawLine);
    if (text) current.lines.push(text);
  }
  return new Map([...sections].map(([k, s]) => [k, { title: s.title, text: s.lines.join("") }]));
}

function probeDuration(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Number.parseFloat(out.trim());
}

function silencesOf(file, duration) {
  // silencedetect logs to stderr; swap the streams so execFileSync returns it.
  const log = execFileSync(
    "sh",
    [
      "-c",
      `ffmpeg -hide_banner -i "$0" -af silencedetect=noise=-40dB:d=0.12 -f null - 2>&1 >/dev/null`,
      file,
    ],
    { encoding: "utf8" },
  );
  const silences = [];
  let start = null;
  for (const line of log.split("\n")) {
    const s = line.match(/silence_start: ([\d.]+)/);
    if (s) start = Number.parseFloat(s[1]);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (e && start !== null) {
      silences.push({ start, end: Number.parseFloat(e[1]) });
      start = null;
    }
  }
  if (start !== null) silences.push({ start, end: duration });
  return silences;
}

function encodeMp3(wav, id) {
  const out = join(outAudioDir, `${id}.mp3`);
  if (existsSync(out) && !force) return;
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    wav,
    "-ac",
    "1",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    out,
  ]);
}

export function listJobs() {
  const jobs = [];
  const common = parseSections(
    readFileSync(join(scriptDir, "common.md"), "utf8"),
    /【予備-(\d+)】/,
  );
  for (const { file, n } of COMMON) {
    const wav = join(audioDir, `${file}.wav`);
    if (!existsSync(wav)) continue;
    const section = common.get(String(n));
    jobs.push({ id: `X-${String(n).padStart(2, "0")}`, track: null, file, wav, section });
  }
  for (const track of TRACKS) {
    const dir = join(audioDir, `track${track}`);
    const mdPath = join(scriptDir, `track${track}.md`);
    if (!existsSync(dir) || !existsSync(mdPath)) continue;
    const sections = parseSections(
      readFileSync(mdPath, "utf8"),
      new RegExp(`\\[(${track}-\\d+)\\]`, "i"),
    );
    const wavs = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".wav"))
      .sort();
    for (const name of wavs) {
      const file = basename(name, ".wav");
      const num = file.match(/^(?:[a-z]-)?(\d+)/i)?.[1];
      if (!num) {
        console.warn(`skip ${track}/${name}: no clip number`);
        continue;
      }
      const id = `${track}-${num.padStart(2, "0")}`;
      jobs.push({ id, track, file, wav: join(dir, name), section: sections.get(id) });
    }
  }
  return jobs;
}

function main() {
  if (!existsSync(audioDir) || !existsSync(scriptDir)) {
    console.error("音声/ と 原稿/ が apps/mc 直下に必要です");
    process.exit(1);
  }
  mkdirSync(outAudioDir, { recursive: true });
  mkdirSync(dirname(outJson), { recursive: true });
  const overrides = existsSync(overridesPath)
    ? JSON.parse(readFileSync(overridesPath, "utf8"))
    : {};

  const jobs = listJobs();

  const clips = [];
  const report = [];
  for (const job of jobs) {
    const raw = overrides[job.id] ?? job.section?.text;
    const text = raw ? fixNotation(raw) : raw;
    if (!text) {
      console.warn(`skip ${job.id} (${job.file}): no manuscript section`);
      continue;
    }
    encodeMp3(job.wav, job.id);
    const duration = probeDuration(job.wav);
    const { segments, stats } = align(splitPhrases(text), silencesOf(job.wav, duration), duration);
    clips.push({
      id: job.id,
      track: job.track,
      file: job.file,
      title: job.section?.title ?? job.file,
      src: `/audio/${job.id}.mp3`,
      durationMs: Math.round(duration * 1000),
      loop: LOOP_DEFAULT.has(job.id),
      segments,
    });
    report.push({ id: job.id, ...stats });
  }

  writeFileSync(outJson, `${JSON.stringify({ clips }, null, 2)}\n`);
  console.log(`wrote ${clips.length} clips → ${outJson}`);
  const cps = report.map((r) => r.cps).sort((a, b) => a - b);
  const median = cps[Math.floor(cps.length / 2)];
  for (const r of report) {
    const suspicious =
      Math.abs(r.cps - median) / median > 0.18 || r.matched < 0.7 || r.unusedPauses > 2;
    console.log(
      `${suspicious ? "⚠" : " "} ${r.id}  ${r.cps.toFixed(2)} chars/s  matched ${(r.matched * 100).toFixed(0)}%  unused long pauses ${r.unusedPauses}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
