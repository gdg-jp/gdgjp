/** Narrow argv allowlist for Shell. Anything outside this grammar is deny. */

const BARE = /^[A-Za-z0-9._/@:,+=-]+$/;
const DELIM = /^[A-Za-z0-9_]+$/;
const FORBIDDEN = new Set([
  "$",
  "`",
  '"',
  "(",
  ")",
  "{",
  "}",
  "|",
  ";",
  "<",
  ">",
  "\\",
  "*",
  "?",
  "[",
  "]",
  "~",
  "!",
  "#",
  "\n",
  "\r",
]);

export type ShellDecision = { ok: true; simples: string[][] } | { ok: false; reason: string };

function extraWkPath(): string | null {
  const raw = process.argv[2];
  if (!raw || !raw.startsWith("/") || raw.includes("..") || raw.includes("//")) return null;
  if (!raw.endsWith("/wk")) return null;
  return raw;
}

export function isAllowedWk(argv0: string): boolean {
  if (argv0 === "wk") return true;
  const extra = extraWkPath();
  return extra !== null && argv0 === extra;
}

function skipWs(input: string, start: number): number {
  let index = start;
  while (index < input.length && (input[index] === " " || input[index] === "\t")) index += 1;
  return index;
}

function readQuoted(input: string, index: number): { value: string; next: number } | null {
  if (input[index] !== "'") return null;
  let cursor = index + 1;
  while (cursor < input.length && input[cursor] !== "'") cursor += 1;
  if (cursor >= input.length) return null;
  return { value: input.slice(index + 1, cursor), next: cursor + 1 };
}

function readBare(input: string, index: number): { value: string; next: number } | null {
  let cursor = index;
  while (cursor < input.length && BARE.test(input[cursor] ?? "")) cursor += 1;
  if (cursor === index) return null;
  const value = input.slice(index, cursor);
  return BARE.test(value) ? { value, next: cursor } : null;
}

function charsetOk(input: string): boolean {
  let inQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuote) {
      if (char === "'") inQuote = false;
      continue;
    }
    if (char === "'") {
      inQuote = true;
      continue;
    }
    if (char === "&" && input[index + 1] === "&") {
      index += 1;
      continue;
    }
    if (char === "&" || FORBIDDEN.has(char)) return false;
  }
  return !inQuote;
}

function tokenizeSimples(input: string): string[][] | null {
  const simples: string[][] = [];
  let index = skipWs(input, 0);
  while (index < input.length) {
    const argv: string[] = [];
    while (index < input.length) {
      index = skipWs(input, index);
      if (index >= input.length) break;
      if (input.startsWith("&&", index)) break;
      const quoted = readQuoted(input, index);
      if (quoted) {
        argv.push(quoted.value);
        index = quoted.next;
        continue;
      }
      const bare = readBare(input, index);
      if (!bare) return null;
      argv.push(bare.value);
      index = bare.next;
    }
    if (argv.length === 0) return null;
    simples.push(argv);
    index = skipWs(input, index);
    if (index >= input.length) break;
    if (!input.startsWith("&&", index)) return null;
    index = skipWs(input, index + 2);
    if (index >= input.length) return null;
  }
  return simples.length > 0 ? simples : null;
}

function parseHereDoc(command: string): ShellDecision | null {
  const newline = command.indexOf("\n");
  if (newline < 0) return null;
  const header = command.slice(0, newline);
  const rest = command.slice(newline + 1);
  let index = skipWs(header, 0);
  const wk = readBare(header, index);
  if (!wk || !isAllowedWk(wk.value)) return null;
  index = skipWs(header, wk.next);
  const writeTok = readBare(header, index);
  if (!writeTok || writeTok.value !== "write") return null;
  index = skipWs(header, writeTok.next);
  const quotedPath = readQuoted(header, index);
  const pathTok = quotedPath ?? readBare(header, index);
  if (!pathTok) return null;
  index = skipWs(header, pathTok.next);
  if (!header.startsWith("<<'", index)) return null;
  index += 3;
  const delimStart = index;
  while (index < header.length && /[A-Za-z0-9_]/.test(header[index] ?? "")) index += 1;
  const delim = header.slice(delimStart, index);
  if (!DELIM.test(delim) || header[index] !== "'") return null;
  index = skipWs(header, index + 1);
  if (index !== header.length) return null;
  const lines = rest.split("\n");
  let terminator = -1;
  for (let line = 0; line < lines.length; line += 1) {
    if (lines[line] === delim) {
      terminator = line;
      break;
    }
  }
  if (terminator < 0) return { ok: false, reason: "here-doc terminator is missing" };
  const after = lines.slice(terminator + 1);
  if (after.some((line) => line.length > 0)) {
    return { ok: false, reason: "here-doc terminator is not the last line" };
  }
  return {
    ok: true,
    simples: [[wk.value, "write", pathTok.value]],
  };
}

export function inspectWkScript(command: string): ShellDecision {
  if (typeof command !== "string" || command.trim() === "") {
    return { ok: false, reason: "shell command is empty" };
  }
  const trimmed = command.replace(/^[ \t]+|[ \t]+$/g, "");
  const hereDoc = parseHereDoc(trimmed);
  if (hereDoc) return hereDoc;
  if (!charsetOk(trimmed)) {
    return { ok: false, reason: "shell uses a metacharacter outside the argv allowlist" };
  }
  const simples = tokenizeSimples(trimmed);
  if (!simples) return { ok: false, reason: "shell command could not be tokenized" };
  for (const argv of simples) {
    const argv0 = argv[0] ?? "";
    if (argv0.includes("=") || !isAllowedWk(argv0)) {
      return { ok: false, reason: "every simple command must start with wk" };
    }
  }
  return { ok: true, simples };
}

export function isGitCommitInvocation(simples: string[][]): boolean {
  return simples.some((argv) => argv[1] === "git" && argv[2] === "commit");
}
