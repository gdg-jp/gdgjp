import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The design fonts (SIL OFL) from google/fonts, put into the local R2 so rendered images load them. */
const FONTS = [
  [
    "GoogleSansFlex.ttf",
    "ofl/googlesansflex/GoogleSansFlex%5BROND%2Copsz%2Cslnt%2Cwdth%2Cwght%5D.ttf",
  ],
  ["LINESeedJP-Regular.ttf", "ofl/lineseedjp/LINESeedJP-Regular.ttf"],
  ["LINESeedJP-Bold.ttf", "ofl/lineseedjp/LINESeedJP-Bold.ttf"],
  ["LINESeedJP-ExtraBold.ttf", "ofl/lineseedjp/LINESeedJP-ExtraBold.ttf"],
  ["GoogleSansCode.ttf", "ofl/googlesanscode/GoogleSansCode%5Bwght%5D.ttf"],
] as const;

export async function seedLocalFonts(cwd: string): Promise<void> {
  const cache = join(cwd, "node_modules", ".cache", "gdg-fonts");
  mkdirSync(cache, { recursive: true });
  for (const [file, path] of FONTS) {
    const local = join(cache, file);
    if (!existsSync(local)) {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        writeFileSync(local, new Uint8Array(await response.arrayBuffer()));
      } catch (error) {
        console.warn(`fonts: could not download ${file} (${error}); RENDER-FONTS-LOADED will fail`);
        continue;
      }
    }
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        `gdgjp-pr-images/fonts/${file}`,
        "--file",
        local,
        "--content-type",
        "font/ttf",
        "--local",
      ],
      { stdio: "ignore", cwd },
    );
  }
}
