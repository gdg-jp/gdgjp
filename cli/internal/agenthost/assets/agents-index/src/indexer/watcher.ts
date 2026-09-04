import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { watch } from "chokidar";

import {
  aclSourcesForChunk,
  memoryMetadata,
  pageMetadata,
  rawMetadata,
  sourceMetadataById,
} from "../acl/frontmatter.ts";
import type { SourceMetadata } from "../acl/frontmatter.ts";
import { chunkMarkdown } from "./chunk.ts";
import type { Embedder } from "./embed.ts";
import type { IndexStore } from "./store.ts";

const watched = [
  "pages/**/*.md",
  "raw/**/*.{md,txt}",
  "memories/**/*.md",
  ".gdgwiki/state.json",
  ".gdgwiki/acl-sources.json",
];

export class IndexWatcher {
  readonly sourceMetadata = new Map<string, SourceMetadata>();
  private state: unknown = null;
  private readonly rawPaths = new Set<string>();
  private readonly root: string;
  private readonly store: IndexStore;
  private readonly embedder: Embedder;

  // Explicit field assignment rather than constructor parameter properties:
  // the agent host runs this file through Node's type-stripping loader, which
  // only accepts erasable TypeScript.
  constructor(root: string, store: IndexStore, embedder: Embedder) {
    this.root = resolve(root);
    this.store = store;
    this.embedder = embedder;
  }

  async start(): Promise<void> {
    await this.reloadAuxiliary();
    const watcher = watch(watched, {
      cwd: this.root,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });
    watcher.on("add", (path) => void this.update(path));
    watcher.on("change", (path) => void this.update(path));
    watcher.on("unlink", (path) => this.store.removePath(path));
  }

  private async reloadAuxiliary(): Promise<void> {
    this.state = await this.json(".gdgwiki/state.json");
    this.sourceMetadata.clear();
    for (const [id, source] of sourceMetadataById(await this.json(".gdgwiki/acl-sources.json")))
      this.sourceMetadata.set(id, source);
  }

  private async json(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(resolve(this.root, path), "utf8"));
    } catch {
      return null;
    }
  }

  async update(path: string): Promise<void> {
    if (path === ".gdgwiki/state.json" || path === ".gdgwiki/acl-sources.json") {
      await this.reloadAuxiliary();
      if (path === ".gdgwiki/state.json")
        for (const rawPath of this.rawPaths) await this.update(rawPath);
      return;
    }
    const absolute = resolve(this.root, path);
    if (!absolute.startsWith(`${this.root}${sep}`)) return;
    let markdown: string;
    try {
      markdown = await readFile(absolute, "utf8");
    } catch {
      this.store.removePath(path);
      return;
    }
    const subject = path.startsWith("pages/")
      ? path.endsWith("/page.md")
        ? pageMetadata(markdown)
        : null
      : path.startsWith("raw/")
        ? rawMetadata(path, this.state)
        : path.startsWith("memories/")
          ? memoryMetadata(markdown)
          : null;
    if (path.startsWith("raw/")) this.rawPaths.add(path);
    if (!subject) {
      this.store.removePath(path);
      return;
    }
    const chunks = await Promise.all(
      chunkMarkdown(markdown).map(async (chunk) => ({
        path,
        ...chunk,
        subject,
        aclSourceIds: aclSourcesForChunk(markdown, chunk),
        embedding: await this.embedder.embed(chunk.text, false),
      })),
    );
    this.store.replacePath(path, chunks);
  }
}
