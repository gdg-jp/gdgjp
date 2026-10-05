import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outfile = "../../apps/cli/internal/wiki/hooks/acl.ts";
const { outputFiles } = await build({
  entryPoints: ["src/acl/agent.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  banner: { js: "// @ts-nocheck" },
  write: false,
});
const content = Buffer.from(outputFiles[0].contents);
const previous = await readFile(outfile).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
if (!previous?.equals(content)) {
  // Go embeds this file while other checks build the same ACL. Publish complete
  // bytes atomically and leave identical output untouched for readers/watchers.
  const temporary = `${outfile}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, outfile);
  } finally {
    await rm(temporary, { force: true });
  }
}
