import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";

function run(command, args, cwd = process.cwd(), environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(command === "go" ? { GOMAXPROCS: "2" } : {}), ...environment },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

{
  const cwd = resolve("apps/cli");
  const unformatted = execFileSync("gofmt", ["-l", "."], { cwd, encoding: "utf8" }).trim();
  if (unformatted) {
    console.error(`Files requiring gofmt:\n${unformatted}`);
    process.exitCode = 1;
  } else {
    process.exitCode = await run("go", ["test", "-vet=all", "-ldflags=-w", "./..."], cwd);
    if (!process.exitCode)
      process.exitCode = await run("go", ["build", "-ldflags=-w", "./..."], cwd);
    if (!process.exitCode) {
      const targets = [
        "darwin/amd64",
        "darwin/arm64",
        "linux/amd64",
        "linux/arm64",
        "windows/amd64",
        "windows/arm64",
      ];
      await Promise.all(
        Array.from({ length: 2 }, async () => {
          while (!process.exitCode && targets.length) {
            const [GOOS, GOARCH] = targets.shift().split("/");
            const code = await run(
              "go",
              ["build", "-p=2", "-ldflags=-s -w", "-o", "/dev/null", "./cmd/gdg"],
              cwd,
              { GOOS, GOARCH },
            );
            if (code) process.exitCode = code;
          }
        }),
      );
    }
  }
}
