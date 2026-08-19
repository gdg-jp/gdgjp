import { execFileSync } from "node:child_process";

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
