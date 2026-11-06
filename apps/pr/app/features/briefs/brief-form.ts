// The brief editor's form: scalar fields plus row tables, and the conversion between a Brief
// and FormData. Pure and shared by the client (rendering) and the action (parsing).
import type { Brief } from "./brief";

export type FieldType =
  | "text"
  | "int"
  | "datetime"
  | "date"
  | "lines"
  | "list"
  | "select"
  | "textarea";

export type Field = {
  path: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  description?: string;
  width?: string;
};

export const SCALAR_SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "イベント",
    fields: [
      { path: "event.name", label: "イベント名", type: "text" },
      {
        path: "event.officialSeries",
        label: "公式シリーズ名",
        type: "text",
        description: "DevFest / Build with AI / I/O Extended など",
      },
      { path: "event.startAt", label: "開始", type: "datetime" },
      { path: "event.endAt", label: "終了", type: "datetime" },
      { path: "event.venue", label: "会場", type: "text" },
      { path: "event.address", label: "住所・アクセス", type: "text" },
      {
        path: "event.format",
        label: "形式",
        type: "select",
        options: [
          { value: "onsite", label: "現地" },
          { value: "online", label: "オンライン" },
          { value: "hybrid", label: "ハイブリッド" },
        ],
      },
      { path: "event.fee", label: "参加費", type: "text" },
      { path: "event.capacity", label: "定員", type: "int" },
      { path: "event.connpassUrl", label: "connpass の URL", type: "text" },
      {
        path: "event.hashtag",
        label: "イベントのハッシュタグ",
        type: "text",
        description: "当日実況に付ける（例 #DevFestKansai）",
      },
    ],
  },
  {
    title: "テーマと目標",
    fields: [
      {
        path: "metaThemes",
        label: "メタテーマ",
        type: "lines",
        description: "1 行に 1 つ。2〜3 個",
      },
      {
        path: "copyConstraints",
        label: "コピーの必須語",
        type: "list",
        description: "カンマ区切り（例 AI, Google）",
      },
      { path: "goals.applications", label: "申込目標", type: "int" },
      { path: "budget.totalYen", label: "予算の総額（円）", type: "int" },
      { path: "budget.printYen", label: "印刷など広告以外（円）", type: "int" },
    ],
  },
  {
    title: "イベント skin",
    fields: [
      { path: "skin.bg", label: "背景色", type: "text" },
      { path: "skin.panelBg", label: "パネルの色", type: "text" },
      { path: "skin.textColor", label: "文字色", type: "text" },
      { path: "skin.accent", label: "アクセント色", type: "list", description: "カンマ区切り" },
      { path: "skin.tone", label: "トーン", type: "text" },
      { path: "skin.brandGuideUrl", label: "公式ブランドガイドの URL", type: "text" },
    ],
  },
  {
    title: "メモ",
    fields: [
      { path: "novelty", label: "ノベルティの案", type: "lines" },
      {
        path: "constraints",
        label: "制約",
        type: "lines",
        description: "言わないこと、避けること",
      },
      { path: "notes", label: "メモ", type: "textarea" },
    ],
  },
];

const tier = [
  { value: "normal", label: "通常" },
  { value: "high", label: "高（依頼しない）" },
];
const sessionStatus = [
  { value: "tba", label: "未定" },
  { value: "confirmed", label: "確定" },
  { value: "public", label: "公開済み" },
];

export type Table = {
  id: string;
  path: string;
  title: string;
  description?: string;
  columns: Field[];
  object?: boolean;
};

export const TABLES: Table[] = [
  {
    id: "segments",
    path: "audienceSegments",
    title: "対象層",
    columns: [
      { path: "id", label: "ID", type: "text", width: "8rem" },
      { path: "label", label: "名前", type: "text" },
      { path: "note", label: "メモ", type: "text" },
    ],
  },
  {
    id: "curve",
    path: "goals.curve",
    title: "週次の目標曲線",
    columns: [
      { path: "date", label: "日付", type: "date" },
      { path: "applications", label: "申込数", type: "int" },
    ],
  },
  {
    id: "speakers",
    path: "speakers",
    title: "登壇者",
    description: "格が高く依頼しづらい人は「高」。自動で依頼を出さない",
    columns: [
      { path: "id", label: "ID", type: "text", width: "8rem" },
      { path: "name", label: "名前", type: "text" },
      { path: "role", label: "肩書き", type: "text" },
      { path: "xHandle", label: "X", type: "text", width: "8rem" },
      { path: "followers", label: "フォロワー", type: "int", width: "6rem" },
      { path: "tier", label: "格", type: "select", options: tier, width: "9rem" },
      { path: "imageUrl", label: "写真 URL", type: "text" },
    ],
  },
  {
    id: "sessions",
    path: "sessions",
    title: "セッション",
    description: "「確定」になるまでセッション紹介は告知しない",
    columns: [
      { path: "id", label: "ID", type: "text", width: "8rem" },
      { path: "title", label: "タイトル", type: "text" },
      { path: "track", label: "トラック", type: "text", width: "7rem" },
      { path: "startAt", label: "開始", type: "datetime" },
      { path: "endAt", label: "終了", type: "datetime" },
      { path: "speakerIds", label: "登壇者 ID", type: "list" },
      { path: "status", label: "状態", type: "select", options: sessionStatus, width: "8rem" },
      {
        path: "flags",
        label: "注記",
        type: "list",
        description: "no_recording, english, onsite_only, bring_pc",
      },
    ],
  },
  {
    id: "streams",
    path: "event.streamUrls",
    title: "配信 URL",
    object: true,
    columns: [
      { path: "key", label: "トラック", type: "text", width: "8rem" },
      { path: "value", label: "URL", type: "text" },
    ],
  },
  {
    id: "accounts",
    path: "accounts",
    title: "配信先アカウント",
    columns: [
      {
        path: "kind",
        label: "種類",
        type: "select",
        options: [
          { value: "x", label: "X" },
          { value: "ig", label: "Instagram" },
          { value: "connpass_group", label: "connpass グループ" },
        ],
        width: "10rem",
      },
      { path: "handle", label: "ハンドル", type: "text" },
      { path: "chapterId", label: "チャプター ID", type: "int", width: "7rem" },
      {
        path: "role",
        label: "役割",
        type: "select",
        options: [
          { value: "primary", label: "主" },
          { value: "mirror", label: "ミラー" },
        ],
        width: "7rem",
      },
    ],
  },
  {
    id: "preEvents",
    path: "preEvents",
    title: "プレイベント",
    columns: [
      { path: "name", label: "名前", type: "text" },
      { path: "date", label: "日付", type: "date" },
      { path: "venue", label: "会場", type: "text" },
      { path: "url", label: "URL", type: "text" },
      { path: "leadsTo", label: "本番への導線", type: "text" },
    ],
  },
];

const JST = 9 * 3600 * 1000;

function get(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], obj);
}

function set(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let node = obj;
  for (const key of keys.slice(0, -1)) {
    node[key] = (node[key] as Record<string, unknown>) ?? {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys.at(-1) as string] = value;
}

/** Brief value → the string an input shows. */
export function toInput(type: FieldType, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "datetime") {
    const ms = Date.parse(String(value));
    return Number.isNaN(ms) ? "" : new Date(ms + JST).toISOString().slice(0, 16);
  }
  if (type === "lines") return Array.isArray(value) ? value.join("\n") : String(value);
  if (type === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  return String(value);
}

/** Input string → brief value (undefined when empty, so compact() drops it). */
export function fromInput(type: FieldType, raw: FormDataEntryValue | null): unknown {
  const text = typeof raw === "string" ? raw.trim() : "";
  // An emptied list is an empty array (a session with no speakers), not a missing key.
  if (!text) return type === "list" || type === "lines" ? [] : undefined;
  if (type === "int") {
    const n = Number(text.replace(/[,，_]/g, ""));
    return Number.isInteger(n) ? n : text;
  }
  if (type === "datetime")
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? `${text}:00+09:00` : text;
  if (type === "lines")
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (type === "list")
    return text
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return text;
}

export const fieldName = (path: string) => `f.${path}`;
export const cellName = (table: string, row: number, column: string) =>
  `t.${table}.${row}.${column}`;

/** Rows of a table as input strings. */
export function tableRows(table: Table, brief: Brief | null): Record<string, string>[] {
  const value = brief ? get(brief, table.path) : undefined;
  if (table.object) {
    return Object.entries((value as Record<string, string>) ?? {}).map(([key, url]) => ({
      key,
      value: url,
    }));
  }
  return ((value as Record<string, unknown>[]) ?? []).map((row) =>
    Object.fromEntries(table.columns.map((c) => [c.path, toInput(c.type, row[c.path])])),
  );
}

export function scalarValue(field: Field, brief: Brief | null): string {
  return toInput(field.type, brief ? get(brief, field.path) : undefined);
}

/**
 * FormData → brief object (not validated; pass it to parseBrief). Fields the form does not show
 * (for example speakers[].sessionIds, connections) are kept from `previous`.
 */
export function briefFromForm(form: FormData, previous: Brief | null): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone((previous ?? {}) as Record<string, unknown>);
  for (const section of SCALAR_SECTIONS) {
    for (const field of section.fields)
      set(out, field.path, fromInput(field.type, form.get(fieldName(field.path))));
  }
  for (const table of TABLES) {
    const rows = new Map<number, Record<string, unknown>>();
    for (const [name, value] of form.entries()) {
      const match = new RegExp(`^t\\.${table.id}\\.(\\d+)\\.(.+)$`).exec(name);
      if (!match) continue;
      const column = table.columns.find((c) => c.path === match[2]);
      if (!column) continue;
      const index = Number(match[1]);
      const row = rows.get(index) ?? {};
      row[column.path] = fromInput(column.type, value);
      rows.set(index, row);
    }
    const ordered = [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
    const filled = ordered.filter((row) =>
      Object.values(row).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0)),
    );
    if (table.object) {
      set(
        out,
        table.path,
        Object.fromEntries(filled.filter((r) => r.key).map((r) => [r.key, r.value])),
      );
      continue;
    }
    const previousRows =
      ((previous ? get(previous, table.path) : undefined) as Record<string, unknown>[]) ?? [];
    set(
      out,
      table.path,
      filled.map((row) => {
        const before = previousRows.find((p) => p.id !== undefined && p.id === row.id) ?? {};
        return { ...before, ...row };
      }),
    );
  }
  return out;
}
