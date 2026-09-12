import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { Button, ThemeProvider } from "@gdgjp/ui";
import tailwind from "@tailwindcss/vite";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "vite";
assert.match(renderToString(createElement(Button, null, "保存")), /gdg-button/);
assert.match(
  renderToString(
    createElement(ThemeProvider, { nonce: "consumer-test" }, createElement(Button, null, "保存")),
  ),
  /nonce="consumer-test"/,
);
const fonts = await readFile("dist/styles/fonts.css", "utf8");
for (const match of fonts.matchAll(/url\("(.*?)"\)/g))
  await access(new URL(`../dist/styles/${match[1]}`, import.meta.url));
await build({
  root: "consumer",
  plugins: [tailwind()],
  build: {
    outDir: "../build/consumer",
    emptyOutDir: true,
    rollupOptions: { input: ["consumer/index.html", "consumer/tailwind.html"] },
  },
});
console.log("Package-only consumer: SSR, nonce, fonts and browser build passed.");
execFileSync("pnpm", ["exec", "tsc", "--noEmit", "-p", "consumer/tsconfig.json"], {
  stdio: "inherit",
});
const { build: esbuild } = await import("esbuild");
await esbuild({
  entryPoints: ["consumer/App.tsx"],
  outfile: "build/consumer-ssr.mjs",
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
});
const { App } = await import("../build/consumer-ssr.mjs");
const { writeFile } = await import("node:fs/promises");
const html = await readFile("build/consumer/index.html", "utf8");
await writeFile(
  "build/consumer/index.html",
  html.replace(
    '<div id="root"></div>',
    `<div id="root">${renderToString(createElement(App))}</div>`,
  ),
);
