import { execFileSync } from "node:child_process";

function readHookInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    let command = "";
    try {
      const payload = JSON.parse(input);
      command = payload.tool_input?.command ?? payload.toolInput?.command ?? "";
    } catch {
      // A malformed hook payload should never prevent a Codex command.
    }

    if (!/\bgit\b[^;&|\n]*\bcommit\b/.test(command)) {
      process.exit(0);
    }

    try {
      execFileSync("pnpm", ["ci:full"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      process.stdout.write(JSON.stringify({ systemMessage: "ci:full passed before git commit." }));
    } catch (error) {
      const output = [error.stdout, error.stderr]
        .filter((value) => typeof value === "string" && value.trim())
        .join("\n")
        .slice(-6000);
      const message = `ci:full failed before git commit.\n${output || "See the command output."}`;
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
