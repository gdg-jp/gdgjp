export const MAX_SHEET_CELLS = 200_000;
export const MAX_SHEET_UTF8_BYTES = 5 * 1024 * 1024;

const TRUNCATION_NOTICE =
  "\n\n> This sheet was truncated during import because it exceeded the 200,000-cell or 5 MB limit.\n";

export interface SheetMarkdownResult {
  markdown: string;
  truncated: boolean;
  cellsIncluded: number;
}

/** Quote a sheet name for the Sheets values API's A1 range syntax. */
export function sheetRange(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n|\r/g, "<br>");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Convert one Sheets API value range to a bounded Markdown table. */
export function sheetValuesToMarkdown(
  title: string,
  values: readonly (readonly unknown[])[],
  limits: { maxCells?: number; maxBytes?: number } = {},
): SheetMarkdownResult {
  const maxCells = limits.maxCells ?? MAX_SHEET_CELLS;
  const maxBytes = limits.maxBytes ?? MAX_SHEET_UTF8_BYTES;
  const heading = `# ${title}`;
  if (values.length === 0) return { markdown: heading, truncated: false, cellsIncluded: 0 };

  const width = Math.max(1, ...values.map((row) => row.length));
  const lines = [heading, ""];
  let bytes = byteLength(`${heading}\n\n`);
  let cellsIncluded = 0;
  let truncated = false;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    if (cellsIncluded + width > maxCells) {
      truncated = true;
      break;
    }
    const row = Array.from({ length: width }, (_, column) =>
      markdownCell(values[rowIndex]?.[column]),
    );
    const line = `| ${row.join(" | ")} |`;
    const separator =
      rowIndex === 0 ? `\n| ${Array.from({ length: width }, () => "---").join(" | ")} |` : "";
    const addition = `${line}${separator}\n`;
    if (bytes + byteLength(addition) > maxBytes) {
      truncated = true;
      break;
    }
    lines.push(line);
    if (separator) lines.push(separator.slice(1));
    bytes += byteLength(addition);
    cellsIncluded += width;
  }

  let markdown = lines.join("\n").trimEnd();
  if (truncated) markdown += TRUNCATION_NOTICE;
  return { markdown, truncated, cellsIncluded };
}
