import { execFileSync } from "node:child_process";
import { constants, accessSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

type HookPayload = {
  tool_input?: {
    command?: unknown;
  };
  toolInput?: {
    command?: unknown;
  };
};

type ExecFileError = {
  stdout?: unknown;
  stderr?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExecFileError(value: unknown): value is ExecFileError {
  return isRecord(value);
}

function usesRepositoryGitHook(command: string): boolean {
  // Only defer simple commits. Bypass flags, git configuration overrides and
  // shell compounds still need the agent-side check before execution.
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const bypassesHook = tokens
    .map((token) => token.replaceAll('"', "").replaceAll("'", ""))
    .some(
      (token) =>
        (token.startsWith("--") && "--no-verify".startsWith(token)) ||
        (token.startsWith("-") && !token.startsWith("--") && token.includes("n")),
    );
  if (
    !/^(?:rtk\s+)?git\s+commit(?:\s|$)/.test(command) ||
    /[;&|<>`$\\\r\n{}()[\]*?~^]/.test(command) ||
    bypassesHook
  ) {
    return false;
  }

  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const hook = execFileSync("git", ["rev-parse", "--git-path", "hooks/pre-commit"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const hookPath = resolve(root, hook);
    accessSync(hookPath, constants.X_OK);
    return (
      realpathSync(hookPath) === realpathSync(resolve(root, ".githooks/pre-commit")) &&
      readFileSync(hookPath, "utf8") ===
        '#!/bin/sh\n\nset -eu\n\nrepo_root="$(git rev-parse --show-toplevel)"\nexec node "$repo_root/scripts/run-pre-commit-ci.mjs"\n'
    );
  } catch {
    return false;
  }
}

function readHookInput(): void {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    let command = "";
    try {
      const parsed: unknown = JSON.parse(input);
      const payload = isRecord(parsed) ? (parsed as HookPayload) : {};
      const candidate = payload.tool_input?.command ?? payload.toolInput?.command ?? "";
      command = typeof candidate === "string" ? candidate : "";
    } catch {
      // A malformed hook payload should never prevent a Codex command.
    }

    if (!/\bgit\b[^;&|\n]*\bcommit\b/.test(command)) {
      process.exit(0);
    }

    if (usesRepositoryGitHook(command)) {
      process.stdout.write(
        JSON.stringify({ systemMessage: "The Git pre-commit hook will run relevant CI checks." }),
      );
      return;
    }

    try {
      execFileSync("pnpm", ["ci:full", "--changed"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      process.stdout.write(
        JSON.stringify({ systemMessage: "Relevant ci:full checks passed before git commit." }),
      );
    } catch (error: unknown) {
      const outputs = isExecFileError(error) ? [error.stdout, error.stderr] : [];
      const output = outputs
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n")
        .slice(-6000);
      const message = `Relevant ci:full checks failed before git commit.\n${output || "See the command output."}`;
      process.stdout.write(
        JSON.stringify({
          systemMessage: message,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: message,
          },
        }),
      );
    }
  });
}

readHookInput();
