import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 6100 || port > 6199) {
  throw new Error("Verification Vite requires a 61xx port");
}
const dependencyRoot = process.env.GDG_E2E_DEPENDENCIES;
if (!dependencyRoot) throw new Error("Verification dependencies were not supplied");
const require = createRequire(resolve("package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const server = await createServer({
  root: process.cwd(),
  server: {
    port,
    strictPort: true,
    fs: { allow: [resolve("../.."), dependencyRoot] },
  },
});
await server.listen();
server.printUrls();
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  });
}
