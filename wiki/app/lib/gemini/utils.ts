import type { PageIndexEntry } from "./types";

export function formatPageIndexAsTree(pages: PageIndexEntry[]): string {
  const childrenMap = new Map<string | null, PageIndexEntry[]>();
  const idSet = new Set(pages.map((p) => p.id));

  for (const page of pages) {
    const key = page.parentId && idSet.has(page.parentId) ? page.parentId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(page);
    childrenMap.set(key, list);
  }

  const lines: string[] = [];

  function walk(parentId: string | null, depth: number) {
    const children = childrenMap.get(parentId);
    if (!children) return;
    for (const page of children) {
      const indent = "  ".repeat(depth);
      const summary = page.summary ? ` -- ${page.summary}` : "";
      lines.push(`${indent}- [id:${page.id}] ${page.title} (slug: ${page.slug})${summary}`);
      walk(page.id, depth + 1);
    }
  }

  walk(null, 0);
  return lines.join("\n");
}

export function buildFeedbackSuffix(feedback: string): string {
  return `\n\n## 前回の出力に対するフィードバック\n${feedback}\n\n上記フィードバックを反映して、再度JSONを出力してください。\n前回の出力を改善し、フィードバックで指摘された点を修正してください。`;
}
