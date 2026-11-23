import { roomName } from "~/features/playback/protocol";
import { type Segment, type UploadedClip, tracks, uploadedSrc } from "./catalog";
import type { ClipInput, NewClipInput } from "./clip-input";

type Row = {
  id: string;
  track: string | null;
  after_id: string | null;
  title: string;
  file: string;
  duration_ms: number;
  segments: string;
  created_at: number;
};

export function audioKey(id: string): string {
  return `clips/${id}`;
}

function toClip(row: Row): UploadedClip {
  return {
    id: row.id,
    track: row.track,
    file: row.file,
    title: row.title,
    src: uploadedSrc(row.id),
    durationMs: row.duration_ms,
    loop: false,
    segments: JSON.parse(row.segments) as Segment[],
    uploaded: true,
    after: row.after_id,
    createdAt: row.created_at,
  };
}

export async function listUploaded(db: D1Database): Promise<UploadedClip[]> {
  const { results } = await db
    .prepare("SELECT * FROM uploaded_clip ORDER BY created_at")
    .all<Row>();
  return results.map(toClip);
}

export async function getUploaded(db: D1Database, id: string): Promise<UploadedClip | null> {
  const row = await db.prepare("SELECT * FROM uploaded_clip WHERE id = ?").bind(id).first<Row>();
  return row ? toClip(row) : null;
}

export async function insertUploaded(db: D1Database, input: NewClipInput): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO uploaded_clip (id, track, after_id, title, file, duration_ms, segments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.track,
      input.after,
      input.title,
      input.file,
      input.durationMs,
      JSON.stringify(input.segments),
      now,
      now,
    )
    .run();
}

export async function updateUploaded(db: D1Database, id: string, input: ClipInput): Promise<void> {
  await db
    .prepare(
      `UPDATE uploaded_clip SET track = ?, after_id = ?, title = ?, segments = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.track, input.after, input.title, JSON.stringify(input.segments), Date.now(), id)
    .run();
}

export async function deleteUploaded(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM uploaded_clip WHERE id = ?").bind(id).run();
}

export async function notifyRooms(env: Env): Promise<void> {
  await Promise.allSettled(tracks.map((t) => env.MC_ROOM.getByName(roomName(t)).refreshCatalog(t)));
}

const TRANSCRIBE_MODEL = "gemini-2.5-pro";

const PROMPT = `この日本語の音声で実際に話されている内容を、一字一句そのまま文字に起こしてください。

- 句読点（、。！？）を自然な位置に付ける
- 英語の固有名詞・イベント名・サービス名は英字で書く（例「デブフェスト関西」ではなく「DevFest Kansai」）
- 同音異義語は文脈に合う漢字にする（例「15回」ではなく「15階」）
- 「え、」「あの」などのつなぎ言葉は、はっきり発音されている場合だけ残す
- 出力は本文のみ。前置き・説明・引用符・改行は付けない`;

export async function transcribe(
  apiKey: string,
  audio: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIBE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: toBase64(audio) } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .replace(/\s*\n\s*/g, "")
    .trim();
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
