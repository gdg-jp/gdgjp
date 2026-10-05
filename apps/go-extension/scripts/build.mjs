import { createWriteStream } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src");
const unpacked = path.join(root, "dist", "unpacked");
const iconSource = path.resolve(root, "../tinyurl/public/gdg_logo.png");

await rm(path.join(root, "dist"), { recursive: true, force: true });
await mkdir(path.join(unpacked, "icons"), { recursive: true });
for (const file of ["manifest.json", "rules.json", "background.js", "redirect.js"]) {
  await cp(path.join(source, file), path.join(unpacked, file));
}
for (const size of [16, 32, 48, 128]) {
  await sharp(iconSource)
    .resize(size, size)
    .png()
    .toFile(path.join(unpacked, "icons", `icon-${size}.png`));
}

await new Promise((resolve, reject) => {
  const output = createWriteStream(path.join(root, "dist", "gdg-japan-go-links.zip"));
  const archive = archiver("zip", { zlib: { level: 9 } });
  output.on("close", resolve);
  output.on("error", reject);
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(unpacked, false);
  void archive.finalize();
});
