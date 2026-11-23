#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { listJobs } from "./build-clips.mjs";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    model: { type: "string", short: "m", default: "gemini-2.5-pro" },
    project: {
      type: "string",
      short: "p",
      default: process.env.GOOGLE_CLOUD_PROJECT ?? "mitame-ai",
    },
    location: {
      type: "string",
      short: "l",
      default: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    },
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const overridesPath = join(root, "scripts", "overrides.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
const only = values.only ? new Set(values.only.split(",")) : null;

const ai = new GoogleGenAI({ vertexai: true, project: values.project, location: values.location });

const PROMPT = `この音声は、下の「原稿」を読み上げ用に作成した日本語のTTS音声です。
音声で実際に話されている内容を、一字一句そのまま文字に起こしてください。

- 原稿と同じ箇所は、原稿の表記（漢字・英字・記号・句読点）をそのまま使う
- 音声と原稿が違う箇所だけ、音声に合わせて書き換える（例：原稿にない文、読まれていない文、言い換え）
- 原稿内の【TBD：…】のようなプレースホルダーは、音声で実際に言っている語句に置き換える
- 英語・固有名詞・カタカナ語は、原稿にある表記を優先する（例「アスクザスピーカー」ではなく原稿の「Ask the speaker」）
- 同音異義語は文脈に合う漢字にする（例「15回」ではなく「15階」）。読み方指示のひらがな（例「16かい」）も「16階」のように直す
- 「え、」「あの」などのつなぎ言葉は、はっきり発音されている場合だけ残す
- 出力は本文のみ。前置き・説明・引用符・改行は付けない

原稿:
`;

let changed = 0;
for (const job of listJobs()) {
  if (only && !only.has(job.id)) continue;
  const script = job.section?.text ?? "";
  const audio = readFileSync(job.wav).toString("base64");
  const res = await ai.models.generateContent({
    model: values.model,
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType: "audio/wav", data: audio } }, { text: PROMPT + script }],
      },
    ],
    config: { temperature: 0 },
  });
  const text = (res.text ?? "").replace(/\s*\n\s*/g, "").trim();
  if (!text) {
    console.warn(`${job.id}: empty response, kept manuscript`);
    continue;
  }
  overrides[job.id] = text;
  changed += 1;
  const same = text === script;
  console.log(`${same ? " " : "≠"} ${job.id}  ${[...script].length} → ${[...text].length} chars`);
  writeFileSync(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`);
}
console.log(`transcribed ${changed} clips → ${overridesPath}`);
