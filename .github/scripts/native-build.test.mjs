import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const modules = fileURLToPath(new URL("../../apps/accounts/node_modules", import.meta.url));

test("native builds retain Worker class names and reject aliased server code in the client", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-native-build-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  symlinkSync(
    modules,
    join(cwd, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  mkdirSync(join(cwd, "app/routes"), { recursive: true });
  const write = (path, text) => writeFileSync(join(cwd, path), text);
  write(
    "package.json",
    JSON.stringify({
      type: "module",
      dependencies: { "react-router": "*", react: "*", "react-dom": "*" },
    }),
  );
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "app-value": ["./app/value.ts"] },
      },
      include: ["app/**/*"],
    }),
  );
  write("react-router.config.ts", "export default { ssr: true };");
  write(
    "vite.config.ts",
    'import { defineConfig } from "vite"; import { reactRouter } from "@react-router/dev/vite"; export default defineConfig({ resolve: { tsconfigPaths: true }, plugins: [reactRouter()], build: { reportCompressedSize: false, rolldownOptions: { output: { keepNames: true } } } });',
  );
  write(
    "app/root.tsx",
    'import { Outlet } from "react-router"; export default function Root() { return <html><body><Outlet /></body></html>; }',
  );
  write(
    "app/routes.ts",
    'import { index } from "@react-router/dev/routes"; export default [index("routes/home.tsx")];',
  );
  write(
    "app/entry.server.tsx",
    'export default function handleRequest() { return new Response("fixture"); }',
  );
  write("app/one.server.ts", "export class WorkerMarker {}");
  write("app/two.server.ts", "export class WorkerMarker {}");
  write("app/value.ts", 'export const value = "public";');
  write("app/private.server.ts", 'export const value = "must never reach the client";');
  write(
    "app/routes/home.tsx",
    'import { WorkerMarker as First } from "../one.server"; import { WorkerMarker as Second } from "../two.server"; import { value } from "app-value"; export function loader() { return [First.name, Second.name]; } export default function Home() { return <p>{value}</p>; }',
  );
  const build = () =>
    spawnSync(process.execPath, [join(modules, "@react-router/dev/bin.js"), "build"], {
      cwd,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
    });
  const valid = build();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  const server = await import(pathToFileURL(join(cwd, "build/server/index.js")));
  assert.deepEqual(server.routes["routes/home"].module.loader(), ["WorkerMarker", "WorkerMarker"]);
  write("app/value.ts", 'export { value } from "./private.server";');
  const invalid = build();
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /Server-only module referenced by client/);

  // Exercise the actual Accounts config: its dev pre-bundling must not replace
  // Cloudflare's Worker entry with React Router's server-only build entry.
  write("app/value.ts", 'export const value = "public";');
  write(
    "vite.config.ts",
    `import config from ${JSON.stringify(fileURLToPath(new URL("../../apps/accounts/vite.config.ts", import.meta.url)))}; export default config;`,
  );
  write(
    "react-router.config.ts",
    `import config from ${JSON.stringify(fileURLToPath(new URL("../../apps/accounts/react-router.config.ts", import.meta.url)))}; export default config;`,
  );
  write(
    "wrangler.toml",
    'name = "gdg-native-build-test"\nmain = "app/worker.ts"\ncompatibility_date = "2025-01-01"\ncompatibility_flags = ["nodejs_compat"]\n',
  );
  write(
    "app/worker.ts",
    'import { createRequestHandler } from "react-router"; export default { fetch(request: Request) { return createRequestHandler(() => import("virtual:react-router/server-build"), "production")(request); } };',
  );
  const worker = build();
  assert.equal(worker.status, 0, worker.stdout + worker.stderr);
  assert.ok(existsSync(join(cwd, "build/server/wrangler.json")));
});
