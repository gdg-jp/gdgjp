import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two-layer ACL (knowledge platform v2): a request first proves it can reach the SPACE,
 * then the unchanged inner ACL decides inside it. A module that runs the inner ACL without
 * a space guard would let a page or source in a private space leak to anyone the inner ACL
 * happens to admit (e.g. a `member`-visibility page in a chapter space).
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(relRoot: string): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(WIKI_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(`${relDir}/${entry.name}`);
        }
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(`${relDir}/${entry.name}`);
      }
    }
  };
  walk(relRoot);
  return out;
}

const INNER_ACL =
  /\b(getEffectivePagePermissions|canAccessSource|redactPageMarkdown|pageAclClearance|canUserSeePageAsync)\(/;
const SPACE_GUARD =
  /\b(requireSpace|requireSpaceForIdentity|requirePageSpace|requireSourceSpace|resolveSpaceAccess|pagesInSpaces|loadViewerContext)\(/;

/** Modules that implement the inner ACL itself, or that only ever act on gdg-jp. */
const EXEMPT: Record<string, string> = {
  "app/features/pages/access.server.ts": "inner ACL implementation",
  "app/features/pages/acl-spans.server.ts": "inner ACL implementation",
  "app/features/pages/visibility.server.ts": "inner ACL implementation",
  "app/features/pages/page-acl-helpers.server.ts": "helpers called after the route guard",
  "app/features/pages/duplicate.server.ts": "called from the page action after requireSpace",
  "app/features/sources/sources-page.server.ts": "action is guarded by the route's requireSpace",
  "app/features/tasks/task-detail.server.ts": "task lists live in gdg-jp only",
  "app/routes/api/tasks/list.ts": "task lists live in gdg-jp only",
  "app/routes/api/tasks/reorder.ts": "task lists live in gdg-jp only",
  "app/routes/api/tasks/task.ts": "task lists live in gdg-jp only",
  "app/routes/api/tasks/teams.ts": "task lists live in gdg-jp only",
  "app/routes/tasks/history.tsx": "task lists live in gdg-jp only",
  "app/routes/tasks/settings.tsx": "task lists live in gdg-jp only",
  "app/features/agent-api/notes.server.ts": "answer notes are filed into gdg-jp only",
  "app/features/agent-api/cli-sync.server.ts": "called from /sync after requireSpaceForIdentity",
  "app/features/ai-search/knowledge-retriever.server.ts": "v1 RAG, removed in Stage 07",
  "app/features/knowledge/viewer-search.server.ts":
    "takes spaceIds its callers resolved with resolveSpaceAccess; drops hits outside them",
  "workers/features/ingestion/persistence/d1/wiki-read-repository.ts":
    "v1 ingestion workspace over gdg-jp, removed in Stage 07",
};

describe("space guard before inner ACL", () => {
  it("every inner-ACL caller also checks the space", () => {
    const offenders = [...sourceFiles("app"), ...sourceFiles("workers")].filter((file) => {
      if (file in EXEMPT) return false;
      const source = readFileSync(join(WIKI_ROOT, file), "utf8");
      return INNER_ACL.test(source) && !SPACE_GUARD.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
