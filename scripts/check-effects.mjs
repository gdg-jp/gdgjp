import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compareCounts, countBy, shrinkCounts } from "./count-baseline.mjs";

export const POLICY_PATH = "scripts/effects-policy.json";
export const BASELINE_PATH = "scripts/effects-baseline.json";
export const DOCS_PATH = "docs/engineering/effects.md";
export const EFFECT_APIS = ["useEffect", "useLayoutEffect"];
export const TIMER_APIS = [
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
];
const APIS = new Set([...EFFECT_APIS, ...TIMER_APIS]);
const GLOBAL_RECEIVERS = new Set(["window", "globalThis", "self"]);
const PREFILTER =
  /useEffect|useLayoutEffect|setTimeout|setInterval|requestAnimationFrame|requestIdleCallback/;
const HOOKS = "@gdgjp/gdg-lib/react";

const productSourcePattern = /^(?:apps\/[^/]+|packages\/gdg-lib)\/.+\.[cm]?[jt]sx?$/;
const excludedPattern =
  /^apps\/(?:learn|cli)\/|\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?|e2e|testing|fixtures|mocks|scripts|eval|node_modules|build|dist|\.react-router|\.wrangler)\//;

export function isEffectSource(path) {
  return productSourcePattern.test(path) && !excludedPattern.test(path);
}

const guidance = {
  "fetcher-result": {
    what: "reacts to a fetcher, action, navigation, or revalidation result",
    replacement: `useValueChange(fetcher.data, onResult) from ${HOOKS}, or the submit handler itself`,
    cause:
      "A result is an event, not state to synchronize. Handle it once where it arrives instead of re-running whenever dependencies change.",
  },
  fetch: {
    what: "loads data after render",
    replacement:
      "the route loader or clientLoader, or fetcher.load() called from the event that needs the data",
    cause:
      "Data a screen needs belongs to the route so React Router can load it in parallel, revalidate it, and avoid waterfalls and races.",
  },
  "media-query": {
    what: "mirrors a media query into state",
    replacement: `useMediaQuery(query, serverValue) from ${HOOKS}`,
    cause:
      "A media query is an external store; read it with useSyncExternalStore so server and client snapshots agree without an extra render.",
  },
  listener: {
    what: "attaches an event listener",
    replacement: `useEventListener("window" | "document" | ref | target, type, handler) from ${HOOKS}`,
    cause:
      "The hook keeps the handler current, so it needs no dependency array and cannot leak or bind a stale closure.",
  },
  interval: {
    what: "runs an interval",
    replacement: `useInterval(callback, delayMs | null) or useNow(intervalMs) from ${HOOKS}; for polling route data, call revalidator.revalidate() from useInterval`,
    cause: "Passing null pauses it; the hook owns cleanup and always calls the latest callback.",
  },
  "animation-frame": {
    what: "drives an animation frame loop",
    replacement: `useAnimationFrame(callback, active) from ${HOOKS}, a CSS transition, or element.animate() in a ref callback`,
    cause: "The hook owns cancellation; a one-shot animation needs no frame loop at all.",
  },
  timeout: {
    what: "schedules a timeout",
    replacement: `useTransientValue(ms) for temporary UI, useDebouncedValue / useDebouncedCallback for debouncing, or useTimeout() from ${HOOKS}`,
    cause:
      "Start the timer from the event that causes it; the hooks cancel on unmount and when restarted.",
  },
  storage: {
    what: "reads or writes browser storage",
    replacement:
      "a useState lazy initializer guarded by useHydrated(), useSyncExternalStore over the storage key, and writes in the handler that changes the value",
    cause:
      "Storage is an external store; copying it into state after mount renders twice and races.",
  },
  dom: {
    what: "measures or drives the DOM",
    replacement:
      "a ref callback that returns its cleanup (React 19), autoFocus / onOpenAutoFocus for focus, or CSS",
    cause:
      "The ref callback runs exactly when the element attaches and detaches, which is the lifetime the DOM work needs.",
  },
  "external-system": {
    what: "connects to an external system",
    replacement: `useSyncExternalStore for a readable store, or useMountEffect(connect) from ${HOOKS} with a React key on the component to reconnect`,
    cause:
      "Reconnecting on dependency changes is the usual source of duplicate sockets; make the lifetime explicit with a key.",
  },
  "derived-state": {
    what: "copies props or other state into state",
    replacement:
      "a value computed during render (useMemo if expensive), a key on the component to reset its state, or the event handler that caused the change",
    cause: "Derived state renders a stale frame first and drifts from its source.",
  },
  effect: {
    what: "synchronizes with something after render",
    replacement: `an event handler, a value computed during render, a route loader, or a hook from ${HOOKS} (useMountEffect for a true mount-time external system)`,
    cause:
      "Most effects respond to an event or derive a value; move the work to where that happens.",
  },
  "abort-deadline": {
    what: "aborts a request after a deadline",
    replacement:
      "AbortSignal.timeout(ms), combined with another signal through AbortSignal.any([...])",
    cause: "The platform signal needs no clearTimeout and cannot outlive the request.",
  },
  sleep: {
    what: "waits by wrapping a timer in a promise",
    replacement: "delay(ms, signal) from @gdgjp/gdg-lib/timing",
    cause: "The shared delay is cancellable through its signal and clears its own timer.",
  },
  "focus-later": {
    what: "defers focus to the next task",
    replacement:
      "autoFocus, a ref callback that focuses the element, or the dialog's onOpenAutoFocus",
    cause: "Focus when the element exists rather than guessing when it will.",
  },
  "react-timer": {
    what: "starts a timer in a React module",
    replacement: `useTimeout(), useTransientValue(ms), useDebouncedCallback(fn, ms), useInterval(fn, ms), or useAnimationFrame(fn) from ${HOOKS}`,
    cause: "A raw timer in a component outlives unmount and closes over stale state.",
  },
  scheduler: {
    what: "keeps an imperative timer in a non-React module",
    replacement:
      "delay() from @gdgjp/gdg-lib/timing for waits, AbortSignal.timeout() for deadlines, or a scheduler injected through the constructor",
    cause:
      "Injected time makes the state machine testable; a reviewed allowance in scripts/effects-policy.json covers code that owns an external protocol such as reconnect or heartbeat.",
  },
};

function effectCategory(text) {
  if (
    /\b\w*[Ff]etcher\w*\.(?:data|state)\b|\bactionData\b|\bnavigation\.state\b|\brevalidator\b/.test(
      text,
    )
  )
    return "fetcher-result";
  if (/\bfetch\(|\.load\(/.test(text)) return "fetch";
  if (/\bmatchMedia\(/.test(text)) return "media-query";
  if (/\baddEventListener\(/.test(text)) return "listener";
  if (/\bsetInterval\(/.test(text)) return "interval";
  if (/\brequestAnimationFrame\(/.test(text)) return "animation-frame";
  if (/\bsetTimeout\(/.test(text)) return "timeout";
  if (/\b(?:localStorage|sessionStorage)\b|document\.cookie/.test(text)) return "storage";
  if (
    /\b(?:ResizeObserver|IntersectionObserver|MutationObserver)\b|\.(?:focus|animate|scrollTo|scrollIntoView|getBoundingClientRect)\(|\.(?:style|scrollTop|textContent)\b/.test(
      text,
    )
  )
    return "dom";
  if (/\bWebSocket\b|\bnew [A-Z]\w*\(|\.subscribe\(|\binstall[A-Z]\w*\(/.test(text))
    return "external-system";
  if (/^\(\)\s*=>\s*\{?\s*(?:if\s*\([^)]*\)\s*)?\{?\s*set[A-Z]\w*\(/.test(text))
    return "derived-state";
  return "effect";
}

function timerCategory(api, node, sourceFile, reactModule) {
  const text = node.arguments[0]?.getText(sourceFile) ?? "";
  if (api === "setTimeout" && /\.abort\(/.test(text)) return "abort-deadline";
  let parent = node.parent;
  const passesCallback = node.arguments[0] !== undefined && ts.isIdentifier(node.arguments[0]);
  while (passesCallback && parent && !ts.isSourceFile(parent)) {
    if (ts.isNewExpression(parent) && parent.expression.getText(sourceFile) === "Promise")
      return "sleep";
    if (ts.isFunctionLike(parent) && !ts.isArrowFunction(parent)) break;
    parent = parent.parent;
  }
  if (/\.focus\(/.test(text)) return "focus-later";
  return reactModule ? "react-timer" : "scheduler";
}

function scriptKind(path) {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function reactBindings(sourceFile) {
  const named = new Map();
  const namespaces = new Set(["React"]);
  let reactModule = false;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (statement.moduleSpecifier.text !== "react") continue;
    reactModule = true;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) namespaces.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (EFFECT_APIS.includes(imported)) named.set(element.name.text, imported);
      }
    }
  }
  return { named, namespaces, reactModule };
}

export function findEffectUses(source, path = "file.tsx") {
  if (!PREFILTER.test(source)) return [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const { named, namespaces, reactModule } = reactBindings(sourceFile);
  const uses = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let api;
      if (ts.isIdentifier(callee)) {
        if (named.has(callee.text)) api = named.get(callee.text);
        else if (TIMER_APIS.includes(callee.text)) api = callee.text;
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        APIS.has(callee.name.text)
      ) {
        const receiver = callee.expression.text;
        if (EFFECT_APIS.includes(callee.name.text) && namespaces.has(receiver))
          api = callee.name.text;
        if (TIMER_APIS.includes(callee.name.text) && GLOBAL_RECEIVERS.has(receiver))
          api = callee.name.text;
      }
      if (api) {
        const category = EFFECT_APIS.includes(api)
          ? effectCategory(node.arguments[0]?.getText(sourceFile) ?? "")
          : timerCategory(api, node, sourceFile, reactModule);
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        uses.push({ api, line: line + 1, category });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return uses;
}

export function describeUse(path, use) {
  const { what, replacement, cause } = guidance[use.category];
  return `${path}:${use.line}: ${use.api} ${what}. Use ${replacement}. Root cause: ${cause}`;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || "git failed").trim());
  return result.stdout;
}

function listPaths(mode, cwd, files) {
  if (mode === "files") return files;
  if (mode === "staged") {
    return git(["diff", "--cached", "--name-only", "-z", "--no-renames", "--diff-filter=ACMR"], cwd)
      .split("\0")
      .filter(Boolean);
  }
  return [
    ...new Set(
      git(
        [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          "apps",
          "packages/gdg-lib",
        ],
        cwd,
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
}

function readSource(path, mode, cwd) {
  if (mode === "staged") {
    const result = spawnSync("git", ["show", `:${path}`], { cwd, encoding: "utf8" });
    return result.status === 0 ? result.stdout : null;
  }
  const full = join(cwd, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function readJson(path, cwd, fallback) {
  const full = join(cwd, path);
  if (!existsSync(full)) return fallback;
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new Error(`${path}: invalid JSON (${error instanceof Error ? error.message : error})`);
  }
}

const key = (path, api) => `${path}\0${api}`;
const splitKey = (value) => value.split("\0");

export function loadPolicy(cwd) {
  const policy = readJson(POLICY_PATH, cwd, { frameworkModules: [], allowances: [] });
  const errors = [];
  const frameworkModules = [];
  for (const [index, entry] of (policy.frameworkModules ?? []).entries()) {
    if (
      typeof entry?.path !== "string" ||
      typeof entry?.reason !== "string" ||
      entry.reason.length < 20
    ) {
      errors.push(`${POLICY_PATH}: frameworkModules[${index}] needs a path and a specific reason`);
      continue;
    }
    frameworkModules.push(entry.path);
  }
  const allowances = new Map();
  for (const [index, entry] of (policy.allowances ?? []).entries()) {
    const label = `${POLICY_PATH}: allowances[${index}]`;
    if (
      typeof entry?.path !== "string" ||
      !APIS.has(entry?.api) ||
      !Number.isInteger(entry?.count) ||
      entry.count < 1 ||
      typeof entry?.reason !== "string" ||
      entry.reason.length < 20
    ) {
      errors.push(
        `${label} needs path, api (${[...APIS].join(", ")}), a positive count, and a reason naming the external constraint`,
      );
      continue;
    }
    if (allowances.has(key(entry.path, entry.api)))
      errors.push(`${label} duplicates ${entry.path} ${entry.api}`);
    allowances.set(key(entry.path, entry.api), entry.count);
  }
  return { frameworkModules, allowances, errors };
}

export function loadBaseline(cwd) {
  const document = readJson(BASELINE_PATH, cwd, { version: 1, entries: [] });
  const errors = [];
  const entries = new Map();
  if (document?.version !== 1 || !Array.isArray(document.entries)) {
    return { entries, errors: [`${BASELINE_PATH}: expected { "version": 1, "entries": [] }`] };
  }
  for (const [index, entry] of document.entries.entries()) {
    if (
      typeof entry?.path !== "string" ||
      !APIS.has(entry?.api) ||
      !Number.isInteger(entry?.count) ||
      entry.count < 1
    ) {
      errors.push(`${BASELINE_PATH}: entries[${index}] needs path, api, and a positive count`);
      continue;
    }
    if (entries.has(key(entry.path, entry.api))) {
      errors.push(`${BASELINE_PATH}: entries[${index}] duplicates ${entry.path} ${entry.api}`);
    }
    entries.set(key(entry.path, entry.api), entry.count);
  }
  return { entries, errors };
}

function writeBaseline(cwd, entries) {
  const sorted = [...entries]
    .map(([value, count]) => {
      const [path, api] = splitKey(value);
      return { path, api, count };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.api.localeCompare(b.api));
  writeFileSync(
    join(cwd, BASELINE_PATH),
    `${JSON.stringify({ version: 1, entries: sorted }, null, 2)}\n`,
  );
}

export function checkEffects({
  mode = "full",
  cwd = process.cwd(),
  files = [],
  writeShrunkBaseline = false,
} = {}) {
  const policy = loadPolicy(cwd);
  const baseline = loadBaseline(cwd);
  const errors = [...policy.errors, ...baseline.errors];
  const framework = (path) =>
    policy.frameworkModules.some((module) =>
      module.endsWith("/") ? path.startsWith(module) : path === module,
    );
  const usesByPath = new Map();
  const inspected = new Set();
  for (const path of listPaths(mode, cwd, files)) {
    if (!isEffectSource(path) || framework(path)) continue;
    const source = readSource(path, mode, cwd);
    if (source === null) continue;
    inspected.add(path);
    const uses = findEffectUses(source, path);
    if (uses.length) usesByPath.set(path, uses);
  }
  const all = [...usesByPath].flatMap(([path, uses]) => uses.map((use) => ({ path, ...use })));
  const actual = countBy(all, (use) => key(use.path, use.api));
  const remaining = new Map();
  for (const [value, count] of actual) {
    const allowed = policy.allowances.get(value) ?? 0;
    if (count > allowed) remaining.set(value, count - allowed);
  }
  for (const [value, allowed] of policy.allowances) {
    const [path, api] = splitKey(value);
    if (!inspected.has(path)) continue;
    const count = actual.get(value) ?? 0;
    if (count < allowed) {
      errors.push(
        `${POLICY_PATH}: allowance for ${path} ${api} expects ${allowed} but found ${count}; lower or delete the allowance so it stays exact`,
      );
    }
  }
  const comparison = compareCounts(remaining, baseline.entries, (value) =>
    inspected.has(splitKey(value)[0]),
  );
  const report = (value, header) => {
    const [path, api] = splitKey(value);
    errors.push(header);
    for (const use of usesByPath.get(path) ?? []) {
      if (use.api === api) errors.push(`  ${describeUse(path, use)}`);
    }
  };
  for (const { key: value, count } of comparison.added) {
    const [path, api] = splitKey(value);
    report(value, `${path}: ${count} new ${api} call${count === 1 ? "" : "s"} in product code`);
  }
  for (const { key: value, count, allowed } of comparison.increased) {
    const [path, api] = splitKey(value);
    report(
      value,
      `${path}: ${api} calls increased from the baseline of ${allowed} to ${count}; remove the new call`,
    );
  }
  if (writeShrunkBaseline && mode === "full") {
    writeBaseline(cwd, shrinkCounts(remaining, baseline.entries));
  } else {
    for (const { key: value, count, allowed } of comparison.shrunk) {
      const [path, api] = splitKey(value);
      errors.push(
        `${path}: ${api} calls dropped from ${allowed} to ${count}; run node scripts/check-effects.mjs --shrink-baseline to lock in the progress`,
      );
    }
  }
  return {
    errors,
    files: inspected.size,
    uses: all.length,
    baselined: [...remaining.values()].reduce((sum, n) => sum + n, 0),
  };
}

export function parseArgs(args) {
  const options = { mode: "full", files: [], writeShrunkBaseline: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--staged") options.mode = "staged";
    else if (argument === "--shrink-baseline") options.writeShrunkBaseline = true;
    else if (argument === "--files") {
      options.mode = "files";
      options.files = args.slice(index + 1);
      break;
    } else
      throw new Error(
        "Usage: node scripts/check-effects.mjs [--staged | --shrink-baseline | --files PATH...]",
      );
  }
  if (options.writeShrunkBaseline && options.mode !== "full") {
    throw new Error(
      "--shrink-baseline inspects every product file and cannot be combined with --staged or --files",
    );
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkEffects({ ...parseArgs(process.argv.slice(2)), cwd: process.cwd() });
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      console.error(
        `Effects and imperative timers are reserved for the shared hooks in packages/gdg-lib/src/react. Read ${DOCS_PATH} for the replacement of each category. A real external constraint needs an exact allowance with its reason in ${POLICY_PATH}; never add entries to ${BASELINE_PATH}.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `PASS effects: ${result.files} product files, ${result.uses} existing calls (${result.baselined} in the shrink-only baseline)`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
