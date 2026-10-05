/** Narrow argv allowlist for Shell. Anything outside this grammar is deny. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BARE = /^[A-Za-z0-9._/@:,+=-]+$/;
const DELIM = /^[A-Za-z0-9_]+$/;
const FORBIDDEN = new Set([
  "$",
  "`",
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

/** acl-gate.ts is invoked as `node acl-gate.ts <extraWkPath> <extraGwsPath>`. */
function extraBinaryPath(argIndex: number, name: string): string | null {
  const raw = process.argv[argIndex];
  if (!raw || !raw.startsWith("/") || raw.includes("..") || raw.includes("//")) return null;
  if (!raw.endsWith(`/${name}`)) return null;
  return raw;
}

export function isAllowedWk(argv0: string): boolean {
  if (argv0 === "wk") return true;
  const extra = extraBinaryPath(2, "wk");
  return extra !== null && argv0 === extra;
}

export function isAllowedGws(argv0: string): boolean {
  if (argv0 === "gws") return true;
  const extra = extraBinaryPath(3, "gws");
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

/** Double quotes are accepted only when the interior cannot expand. */
function readDoubleQuoted(input: string, index: number): { value: string; next: number } | null {
  if (input[index] !== '"') return null;
  let cursor = index + 1;
  while (cursor < input.length && input[cursor] !== '"') {
    const char = input[cursor] ?? "";
    if (char === "$" || char === "`" || char === "\\" || char === "\n" || char === "\r")
      return null;
    cursor += 1;
  }
  if (cursor >= input.length) return null;
  const value = input.slice(index + 1, cursor);
  return BARE.test(value) ? { value, next: cursor + 1 } : null;
}

function readBare(input: string, index: number): { value: string; next: number } | null {
  let cursor = index;
  while (cursor < input.length && BARE.test(input[cursor] ?? "")) cursor += 1;
  if (cursor === index) return null;
  const value = input.slice(index, cursor);
  return BARE.test(value) ? { value, next: cursor } : null;
}

/**
 * Agents habitually append `2>&1` to merge stderr into stdout for visibility; it
 * doesn't read or write a file and can't chain into another command, unlike a bare
 * `>`/`<`/`&`, which stay forbidden everywhere else in the string. Strip only this
 * exact, unquoted trailing form before grammar validation.
 */
function stripTrailingStderrMerge(input: string): string {
  return input.replace(/[ \t]+2>&1[ \t]*$/, "");
}

function charsetOk(input: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === "$" || char === "`" || char === "\\" || char === "\n" || char === "\r")
        return false;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    // POSIX single quotes have no escapes, so a literal `'` inside a single-quoted
    // value can only be spelled by closing the quote, escaping a bare `'`, and
    // reopening: '...'\''...'. Allow exactly that one escape outside quotes; every
    // other backslash use stays forbidden.
    if (char === "\\" && input[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (char === "&" && input[index + 1] === "&") {
      index += 1;
      continue;
    }
    if (char === "&" || FORBIDDEN.has(char)) return false;
  }
  return quote === null;
}

/**
 * Reads one shell word: a maximal run of quoted segments, the `\'` literal-quote
 * escape, and bare runs with no intervening whitespace, concatenated into a single
 * value — matching how a real shell joins adjacent fragments into one argument
 * (e.g. '{"q": "x='\''y'\''"}' is one word, not three).
 */
function readWord(input: string, index: number): { value: string; next: number } | null {
  let cursor = index;
  let value = "";
  let matchedAny = false;
  while (cursor < input.length) {
    const char = input[cursor];
    if (char === " " || char === "\t" || input.startsWith("&&", cursor)) break;
    const squoted = readQuoted(input, cursor);
    if (squoted) {
      value += squoted.value;
      cursor = squoted.next;
      matchedAny = true;
      continue;
    }
    const dquoted = readDoubleQuoted(input, cursor);
    if (dquoted) {
      value += dquoted.value;
      cursor = dquoted.next;
      matchedAny = true;
      continue;
    }
    if (char === "\\" && input[cursor + 1] === "'") {
      value += "'";
      cursor += 2;
      matchedAny = true;
      continue;
    }
    const bare = readBare(input, cursor);
    if (bare) {
      value += bare.value;
      cursor = bare.next;
      matchedAny = true;
      continue;
    }
    break;
  }
  return matchedAny ? { value, next: cursor } : null;
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
      const word = readWord(input, index);
      if (!word) return null;
      argv.push(word.value);
      index = word.next;
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
  const trimmed = stripTrailingStderrMerge(command.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, ""));
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

/** Peeks at the first token of a shell command without validating the rest. */
export function peekArgv0(command: string): string | null {
  if (typeof command !== "string") return null;
  const trimmed = command.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
  const index = skipWs(trimmed, 0);
  const token =
    readQuoted(trimmed, index) ?? readDoubleQuoted(trimmed, index) ?? readBare(trimmed, index);
  return token ? token.value : null;
}

/** local-file exfiltration vector; every other flag outside GWS_ALLOWED_FLAGS is also deny. */
const GWS_UPLOAD_FLAG = "--upload";
const GWS_ALLOWED_FLAGS = new Set([
  "--params",
  "--json",
  "--page-all",
  "--page-limit",
  "--format",
  "--dry-run",
  "--page-delay",
  "--api-version",
]);

function gwsFlagsOk(argsAfterBinary: string[]): { ok: true } | { ok: false; reason: string } {
  for (const token of argsAfterBinary) {
    if (!token.startsWith("-")) continue;
    // clap (gws-bin's arg parser) accepts `--flag=value` as well as `--flag value`;
    // match on the flag name only, same as the space-separated form already does.
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    if (flag === GWS_UPLOAD_FLAG) {
      return { ok: false, reason: "gws --upload is not permitted (local-file exfiltration risk)" };
    }
    if (!GWS_ALLOWED_FLAGS.has(flag)) {
      return { ok: false, reason: `gws flag ${flag} is not on the approved flag list` };
    }
  }
  return { ok: true };
}

/**
 * gws's command surface is Discovery-driven, not statically enumerable — Google
 * could add a more dangerous method under an already-approved resource at any
 * time. Match the exact "service resource method" (or "service +helper")
 * signature only; never fall back to a resource-level or service-level wildcard.
 */
function gwsSignature(argsAfterBinary: string[], allowlist: Set<string>): string | null {
  for (const length of [3, 2]) {
    if (argsAfterBinary.length < length) continue;
    const candidate = argsAfterBinary.slice(0, length).join(" ");
    if (allowlist.has(candidate)) return candidate;
  }
  return null;
}

export function isApprovedGwsArgs(
  argsAfterBinary: string[],
  allowlist: Set<string>,
): { ok: true } | { ok: false; reason: string } {
  const flags = gwsFlagsOk(argsAfterBinary);
  if (!flags.ok) return flags;
  const signature = gwsSignature(argsAfterBinary, allowlist);
  if (!signature) {
    return {
      ok: false,
      reason: "gws command is not on the approved service/resource/method allowlist",
    };
  }
  return { ok: true };
}

export function inspectGwsScript(command: string, allowlist: Set<string>): ShellDecision {
  if (typeof command !== "string" || command.trim() === "") {
    return { ok: false, reason: "shell command is empty" };
  }
  const trimmed = stripTrailingStderrMerge(command.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, ""));
  if (!charsetOk(trimmed)) {
    return { ok: false, reason: "shell uses a metacharacter outside the argv allowlist" };
  }
  const simples = tokenizeSimples(trimmed);
  if (!simples) return { ok: false, reason: "shell command could not be tokenized" };
  for (const argv of simples) {
    const argv0 = argv[0] ?? "";
    if (argv0.includes("=") || !isAllowedGws(argv0)) {
      return { ok: false, reason: "every simple command must start with gws" };
    }
    const approved = isApprovedGwsArgs(argv.slice(1), allowlist);
    if (!approved.ok) return { ok: false, reason: approved.reason };
  }
  return { ok: true, simples };
}

/**
 * Fail closed: a missing, unreadable, or malformed allowlist approves nothing.
 *
 * The path is `~/.cursor/permissions.json` by default (Cursor's own config directory).
 * A backend whose bundle isn't rooted there (e.g. Antigravity, Stage 14) must set
 * GDG_GWS_ALLOWLIST_PATH so this stays backend-independent without moving Cursor's file.
 */
export function loadGwsAllowlist(): Set<string> {
  const override = process.env.GDG_GWS_ALLOWLIST_PATH;
  if (override) {
    try {
      const raw = readFileSync(override, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return new Set();
      const list = (parsed as { gwsAllowlist?: unknown }).gwsAllowlist;
      if (!Array.isArray(list)) return new Set();
      return new Set(list.filter((entry): entry is string => typeof entry === "string"));
    } catch {
      return new Set();
    }
  }
  const home = process.env.HOME;
  if (!home) return new Set();
  try {
    const raw = readFileSync(join(home, ".cursor", "permissions.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return new Set();
    const list = (parsed as { gwsAllowlist?: unknown }).gwsAllowlist;
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}
