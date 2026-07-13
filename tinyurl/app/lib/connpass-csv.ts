export type ConnpassCsvRow = Record<string, string>;

export type ConnpassParticipant = {
  participantId: string;
  participationType: string;
  participationStatus: string;
  registeredAt: number | null;
  registeredAtLabel: string;
  lastUpdatedAt: number | null;
  lastUpdatedAtLabel: string;
  responses: Record<string, string>;
};

export type ParsedConnpassCsv = {
  headers: string[];
  questionHeaders: string[];
  participants: ConnpassParticipant[];
};

const STANDARD_HEADERS = new Set([
  "参加枠名",
  "参加枠",
  "ユーザー名",
  "表示名",
  "利用開始日",
  "コメント",
  "参加ステータス",
  "出欠ステータス",
  "出席日時",
  "更新日時",
  "参加登録日時",
  "登録日時",
  "受付番号",
]);

const PARTICIPANT_ID_HEADERS = ["受付番号", "参加者ID", "参加者 ID"];
const PARTICIPATION_TYPE_HEADERS = ["参加枠名", "参加枠"];
const PARTICIPATION_STATUS_HEADERS = ["参加ステータス"];
const REGISTERED_AT_HEADERS = ["参加登録日時", "登録日時"];
const LAST_UPDATED_AT_HEADERS = ["更新日時"];

function firstPresent(headers: string[], candidates: string[]): string | null {
  return candidates.find((candidate) => headers.includes(candidate)) ?? null;
}

/** Parse RFC 4180-style CSV, including BOM, CRLF, escaped quotes, and newlines in fields. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) throw new Error("CSVの引用符が閉じられていません。");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((values) => values.some((value) => value.length > 0));
}

export function parseConnpassDate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const japanese = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2})時(\d{1,2})分$/.exec(trimmed);
  if (japanese) {
    const [, year, month, day, hour, minute] = japanese;
    // connpass exports event administration timestamps in Japan Standard Time.
    const parts = [year, month, day, hour, minute].map(Number);
    const timestamp = Math.floor(
      Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3] - 9, parts[4]) / 1000,
    );
    const japanTime = new Date(timestamp * 1000 + 9 * 60 * 60 * 1000);
    if (
      japanTime.getUTCFullYear() !== parts[0] ||
      japanTime.getUTCMonth() !== parts[1] - 1 ||
      japanTime.getUTCDate() !== parts[2] ||
      japanTime.getUTCHours() !== parts[3] ||
      japanTime.getUTCMinutes() !== parts[4]
    ) {
      return null;
    }
    return timestamp;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

export function parseConnpassParticipantsCsv(text: string): ParsedConnpassCsv {
  if (text.length > 10_000_000) throw new Error("CSVが大きすぎます（上限10MB）。");
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("CSVが空です。");

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) {
    throw new Error("名前のないCSV列があります。");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("同じ名前のCSV列が複数あります。");
  }

  const participantIdHeader = firstPresent(headers, PARTICIPANT_ID_HEADERS);
  const participationTypeHeader = firstPresent(headers, PARTICIPATION_TYPE_HEADERS);
  const participationStatusHeader = firstPresent(headers, PARTICIPATION_STATUS_HEADERS);
  const registeredAtHeader = firstPresent(headers, REGISTERED_AT_HEADERS);
  const lastUpdatedAtHeader = firstPresent(headers, LAST_UPDATED_AT_HEADERS);
  if (!participantIdHeader || !participationTypeHeader) {
    throw new Error("connpass参加者CSVに必要な列（受付番号・参加枠名）がありません。");
  }

  const questionHeaders = headers.filter((header) => !STANDARD_HEADERS.has(header));
  if (rows.length > 20_001) throw new Error("CSVの参加者数が上限（20,000人）を超えています。");

  const participantIds = new Set<string>();
  const participants = rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(
        `${rowIndex + 2}行目の列数がヘッダーと一致しません（${values.length}/${headers.length}列）。`,
      );
    }
    const row: ConnpassCsvRow = Object.fromEntries(
      headers.map((header, columnIndex) => [header, values[columnIndex]?.trim() ?? ""]),
    );
    const participantId = row[participantIdHeader];
    if (!participantId) throw new Error(`${rowIndex + 2}行目に受付番号がありません。`);
    if (participantIds.has(participantId)) {
      throw new Error(`${rowIndex + 2}行目の受付番号が重複しています。`);
    }
    participantIds.add(participantId);
    if (!row[participationTypeHeader]) {
      throw new Error(`${rowIndex + 2}行目に参加枠名がありません。`);
    }

    const lastUpdatedAt = lastUpdatedAtHeader ? parseConnpassDate(row[lastUpdatedAtHeader]) : null;
    const lastUpdatedAtLabel = lastUpdatedAtHeader ? row[lastUpdatedAtHeader] : "";
    const explicitRegisteredAt = registeredAtHeader
      ? parseConnpassDate(row[registeredAtHeader])
      : null;
    const explicitRegisteredAtLabel = registeredAtHeader ? row[registeredAtHeader] : "";

    return {
      participantId,
      participationType: row[participationTypeHeader],
      participationStatus: participationStatusHeader ? row[participationStatusHeader] : "",
      registeredAt: explicitRegisteredAt ?? lastUpdatedAt,
      registeredAtLabel: explicitRegisteredAtLabel || lastUpdatedAtLabel,
      lastUpdatedAt,
      lastUpdatedAtLabel,
      responses: Object.fromEntries(questionHeaders.map((question) => [question, row[question]])),
    };
  });

  return { headers, questionHeaders, participants };
}

export function isCancelledParticipant(participant: ConnpassParticipant): boolean {
  return /キャンセル|取消|辞退/.test(participant.participationStatus);
}

export function uniqueAnswers(participants: ConnpassParticipant[], question: string): string[] {
  return [
    ...new Set(
      participants
        .map((participant) => participant.responses[question]?.trim())
        .filter((answer): answer is string => Boolean(answer)),
    ),
  ];
}

export function splitAnswerOptions(answer: string): string[] {
  return [
    ...new Set(
      answer
        .split(/[,、，/／\n]+/)
        .map((option) => option.trim())
        .filter(Boolean),
    ),
  ];
}

export function uniqueAnswerOptions(
  participants: ConnpassParticipant[],
  question: string,
): string[] {
  return [
    ...new Set(
      participants.flatMap((participant) =>
        splitAnswerOptions(participant.responses[question] ?? ""),
      ),
    ),
  ];
}

export function eventIdFromFilename(filename: string): string | null {
  return /(?:^|[_-])event[_-](\d+)(?:[_-]|\.)/i.exec(filename)?.[1] ?? null;
}
