import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const compiler = fileURLToPath(
  new URL("../../node_modules/@typescript/native/bin/tsc", import.meta.url),
);

test("native typecheck checks aliases, generated route types and Worker bindings", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-native-typecheck-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, content) => writeFileSync(join(cwd, path), content);
  mkdirSync(join(cwd, "app/routes"), { recursive: true });
  mkdirSync(join(cwd, ".react-router/types/app/routes/+types"), { recursive: true });
  write(
    "tsconfig.json",
    JSON.stringify({
      extends: fileURLToPath(new URL("../../tsconfig.base.json", import.meta.url)),
      compilerOptions: {
        types: [],
        rootDirs: [".", "./.react-router/types"],
        paths: { "~/*": ["./app/*"] },
      },
      include: ["app/**/*", ".react-router/types/**/*", "worker-configuration.d.ts"],
    }),
  );
  write(".react-router/types/app/routes/+types/index.ts", "export type Route = { name: string };");
  write("worker-configuration.d.ts", "interface Env { APP_URL: string }");
  write("app/value.ts", "export const name = 42;");
  write(
    "app/routes/index.ts",
    'import { name } from "~/value"; import type { Route } from "./+types/index"; export const route: Route = { name };',
  );
  write("app/worker.ts", "declare const env: Env; export const url: number = env.APP_URL;");
  const check = () =>
    spawnSync(process.execPath, [compiler, "--project", cwd, "--noEmit", "--pretty", "false"], {
      cwd,
      encoding: "utf8",
    });
  const invalid = check();
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  assert.match(invalid.stdout, /app[/\\]routes[/\\]index\.ts.*TS2322/);
  assert.match(invalid.stdout, /app[/\\]worker\.ts.*TS2322/);

  write("app/value.ts", 'export const name = "GDG";');
  write("app/worker.ts", "declare const env: Env; export const url: string = env.APP_URL;");
  const valid = check();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.equal(existsSync(join(cwd, "app/routes/index.js")), false);
});
