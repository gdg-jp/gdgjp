import type { RouteConfigEntry } from "@react-router/dev/routes";
import { describe, expect, it } from "vitest";
import routes from "../../app/routes";

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
