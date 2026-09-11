import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/styles", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
await cp("src/styles", "dist/styles", { recursive: true });
await cp("assets", "dist/assets", { recursive: true });

await writeFile(
  "dist/styles/fonts.css",
  (await readFile("dist/styles/fonts.css", "utf8")).replaceAll("../../assets/", "../assets/"),
);
