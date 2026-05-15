/**
 * Server-side TipTap JSON → Markdown converter.
 *
 * Pure JSON traversal — no DOM required, runs in Cloudflare Workers.
 * Used to convert existing page content_ja (TipTap JSON) to Markdown
 * for Phase 2b Patcher context.
 */

// ---------------------------------------------------------------------------
// TipTap document node types (minimal subset we need to handle)
// ---------------------------------------------------------------------------

export interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: TipTapMark[];
  text?: string;
}

export interface TipTapDoc {
  type: "doc";
  content?: TipTapNode[];
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

export function tiptapToMarkdown(doc: TipTapDoc | TipTapNode | string): string {
  if (typeof doc === "string") {
    try {
      const parsed = JSON.parse(doc) as TipTapDoc | TipTapNode;
      return convertNode(parsed as TipTapNode).trim();
    } catch {
      return doc;
    }
  }
  if (!doc || typeof doc !== "object") return "";
  return convertNode(doc as TipTapNode).trim();
}

function convertNode(
  node: TipTapNode,
  listContext?: { type: "bullet" | "ordered"; index: number },
): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((n) => convertNode(n)).join("\n\n");

    case "paragraph": {
      const inner = convertInline(node.content ?? []);
      return inner || "";
    }

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const hashes = "#".repeat(Math.min(level, 6));
      const inner = convertInline(node.content ?? []);
      return `${hashes} ${inner}`;
    }

    case "bulletList":
      return (node.content ?? [])
        .map((item, idx) => convertNode(item, { type: "bullet", index: idx }))
        .join("\n");

    case "orderedList":
      return (node.content ?? [])
        .map((item, idx) => convertNode(item, { type: "ordered", index: idx + 1 }))
        .join("\n");

    case "listItem": {
      const prefix = listContext?.type === "ordered" ? `${listContext.index}.` : "-";
      const children = node.content ?? [];
      const lines: string[] = [];
      for (const child of children) {
        if (child.type === "paragraph") {
          lines.push(`${prefix} ${convertInline(child.content ?? [])}`);
        } else if (child.type === "bulletList" || child.type === "orderedList") {
          // Nested list — indent by 2 spaces
          const nested = convertNode(child);
          const indented = nested
            .split("\n")
            .map((l) => `  ${l}`)
            .join("\n");
          lines.push(indented);
        } else {
          lines.push(convertNode(child));
        }
      }
      return lines.join("\n");
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "blockquote": {
      const inner = (node.content ?? []).map((n) => convertNode(n)).join("\n\n");
      return inner
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    }

    case "horizontalRule":
      return "---";

    case "hardBreak":
      return "\n";

    case "image": {
      const src = (node.attrs?.src as string) ?? "";
      const alt = (node.attrs?.alt as string) ?? "";
      const title = (node.attrs?.title as string) ?? "";
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }

    case "table": {
      const rows = node.content ?? [];
      if (rows.length === 0) return "";
      const lines: string[] = [];
      rows.forEach((row, rowIdx) => {
        const cells = (row.content ?? []).map((cell) => {
          const inner = (cell.content ?? [])
            .map((n) => convertNode(n))
            .join(" ")
            .replace(/\|/g, "\\|");
          return inner.trim();
        });
        lines.push(`| ${cells.join(" | ")} |`);
        if (rowIdx === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      return lines.join("\n");
    }

    // Pass-through for tableRow — handled by table
    case "tableRow":
      return (node.content ?? []).map((n) => convertNode(n)).join(" | ");

    case "tableCell":
    case "tableHeader":
      return (node.content ?? []).map((n) => convertNode(n)).join(" ");

    default:
      // Unknown node — recurse into children
      if (node.content) {
        return node.content.map((n) => convertNode(n)).join("");
      }
      return node.text ?? "";
  }
}

function convertInline(nodes: TipTapNode[]): string {
  return nodes.map((node) => convertInlineNode(node)).join("");
}

const MARK_PRIORITY: Record<string, number> = {
  link: 0,
  strike: 1,
  bold: 2,
  italic: 3,
  code: 4,
};

function convertInlineNode(node: TipTapNode): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    const marks = [...(node.marks ?? [])].sort(
      (a, b) => (MARK_PRIORITY[a.type] ?? 99) - (MARK_PRIORITY[b.type] ?? 99),
    );

    // Apply marks in deterministic order
    for (const mark of marks) {
      switch (mark.type) {
        case "bold":
          text = `**${text}**`;
          break;
        case "italic":
          text = `_${text}_`;
          break;
        case "code":
          text = `\`${text}\``;
          break;
        case "link": {
          const href = (mark.attrs?.href as string) ?? "#";
          text = `[${text}](${href})`;
          break;
        }
        case "strike":
          text = `~~${text}~~`;
          break;
        default:
          break;
      }
    }
    return text;
  }

  if (node.type === "hardBreak") return "\n";
  if (node.type === "image") return convertNode(node);

  // Inline content with nested nodes
  if (node.content) {
    return convertInline(node.content);
  }
  return node.text ?? "";
}

// ---------------------------------------------------------------------------
// Patch application: merge section patches into existing markdown
// ---------------------------------------------------------------------------

export interface SectionPatch {
  headingMatch: string | null;
  operation: "append" | "prepend";
  newHeading?: string;
  content: string;
}

/**
 * Applies section patches to existing markdown content.
 * Splits existing markdown into sections by heading, then inserts patch
 * content at the appropriate locations.
 */
export function applyPatchesToMarkdown(existingMarkdown: string, patches: SectionPatch[]): string {
  if (!existingMarkdown.trim()) {
    // No existing content — just render patches as sections
    return patches
      .map((p) => {
        const heading = p.newHeading ?? p.headingMatch ?? "New Section";
        return `## ${heading}\n\n${p.content}`;
      })
      .join("\n\n");
  }

  // Split existing markdown into sections by heading (## or #)
  const lines = existingMarkdown.split("\n");
  const sections: { heading: string | null; lines: string[] }[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  let inCodeFence = false;

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inCodeFence = !inCodeFence;
      current.lines.push(line);
      continue;
    }

    const headingMatch = !inCodeFence ? line.match(/^(#{1,6})\s+(.+)$/) : null;
    if (headingMatch) {
      if (current.heading !== null || current.lines.length > 0) {
        sections.push(current);
      }
      current = { heading: headingMatch[2].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  // Apply each patch
  for (const patch of patches) {
    const patchBlock = patch.newHeading
      ? `\n\n## ${patch.newHeading}\n\n${patch.content}`
      : `\n${patch.content}`;

    if (patch.headingMatch === null) {
      // null headingMatch → append/prepend to entire document
      if (patch.operation === "prepend") {
        sections[0].lines.unshift(patchBlock);
      } else {
        sections[sections.length - 1].lines.push(patchBlock);
      }
      continue;
    }

    // Find matching section by heading text
    const idx = sections.findIndex(
      (s) => s.heading !== null && s.heading.trim() === patch.headingMatch?.trim(),
    );

    if (idx !== -1) {
      if (patch.operation === "prepend") {
        // Insert after heading line
        sections[idx].lines.splice(1, 0, patchBlock);
      } else {
        sections[idx].lines.push(patchBlock);
      }
    } else {
      // Heading not found — append as new section at the end
      const heading = patch.newHeading ?? patch.headingMatch;
      sections.push({ heading, lines: [`## ${heading}`, "", patch.content] });
    }
  }

  return sections
    .map((s) => s.lines.join("\n"))
    .join("\n")
    .trim();
}
