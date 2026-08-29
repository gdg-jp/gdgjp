import type { RouteConfigEntry } from "@react-router/dev/routes";
import { describe, expect, it } from "vitest";
import routes from "../../app/routes";

/**
 * Freezes the full set of URLs that `app/routes.ts` exposes. The Stage 04
 * routes-tree refactor only rewrites the *file* argument of each
 * `route()` / `index()` / `layout()` call — never the URL argument. This
 * snapshot is the guardrail: a diff here means a URL moved, which would 404
 * external links, bookmarks, and the `gdg` CLI's `/api/cli/wiki/*` calls.
 *
 * Take the snapshot BEFORE moving any files. Regenerating it after a broken
 * move would bake the broken URL in.
 */

function joinPath(parent: string, raw: string): string {
  if (raw.startsWith("/")) return raw;
  return `${parent.replace(/\/$/, "")}/${raw}`;
}

function collect(entries: readonly RouteConfigEntry[], parent: string, out: string[]): void {
  for (const entry of entries) {
    const here = entry.path === undefined ? parent : joinPath(parent, entry.path);
    if (entry.index) {
      out.push(`${parent || "/"} (index)`);
    } else if (entry.path !== undefined) {
      out.push(here);
    }
    if (entry.children) collect(entry.children, here, out);
  }
}

describe("routes.ts URL surface", () => {
  it("exposes a stable set of URLs", () => {
    const urls: string[] = [];
    collect(routes as RouteConfigEntry[], "", urls);
    expect([...new Set(urls)].sort()).toMatchSnapshot();
  });
});
