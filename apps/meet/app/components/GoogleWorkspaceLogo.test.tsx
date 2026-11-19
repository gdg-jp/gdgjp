import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_WORKSPACE_LOGO_SRC,
  type GoogleWorkspaceBrand,
  GoogleWorkspaceLogo,
} from "./GoogleWorkspaceLogo";

const PUBLIC_DIR = fileURLToPath(new URL("../../public", import.meta.url));

describe("GoogleWorkspaceLogo", () => {
  it("renders each official brand logo as a decorative img with expected dimensions", () => {
    const brands: Array<{ brand: GoogleWorkspaceBrand; size: 16 | 18 | 20 | 24; cls: string }> = [
      { brand: "google", size: 18, cls: "size-[18px]" },
      { brand: "meet", size: 20, cls: "size-5" },
      { brand: "calendar", size: 16, cls: "size-4" },
      { brand: "docs", size: 16, cls: "size-4" },
      { brand: "drive-video", size: 24, cls: "size-6" },
    ];

    for (const { brand, size, cls } of brands) {
      const html = renderToStaticMarkup(<GoogleWorkspaceLogo brand={brand} size={size} />);
      expect(html).toContain(`src="${GOOGLE_WORKSPACE_LOGO_SRC[brand]}"`);
      expect(html).toContain('alt=""');
      expect(html).toContain(`width="${size}"`);
      expect(html).toContain(`height="${size}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(cls);
    }
  });

  it("keeps static SVG assets sanitized, square-viewBoxed, and free of active content", () => {
    const svgPaths = [
      "favicon.svg",
      ...Object.values(GOOGLE_WORKSPACE_LOGO_SRC).map((s) => s.slice(1)),
    ];

    for (const relPath of svgPaths) {
      const raw = readFileSync(join(PUBLIC_DIR, relPath), "utf8");
      const trimmed = raw.trim();

      expect(trimmed.startsWith("<svg"), `${relPath} should start with <svg`).toBe(true);
      expect(trimmed).toMatch(/\bviewBox="[^"]+"/);
      expect(trimmed).not.toMatch(/<script\b/i);
      expect(trimmed).not.toMatch(/javascript:/i);
      expect(trimmed).not.toMatch(/<!DOCTYPE/i);
      expect(trimmed).not.toMatch(/<!ENTITY/i);
      expect(trimmed).not.toMatch(/\son[a-z]+\s*=/i);

      const withoutXmlns = trimmed.replace(/\bxmlns(?::[a-z0-9_-]+)?="https?:\/\/[^"]*"/gi, "");
      expect(withoutXmlns).not.toMatch(/https?:\/\//i);

      expect(trimmed).not.toMatch(/inkscape|sodipodi|mask-id|yLKXEe|Q6yead|L1hHpb/i);
    }

    const favicon = readFileSync(join(PUBLIC_DIR, "favicon.svg"), "utf8");
    const meetIcon = readFileSync(join(PUBLIC_DIR, "icons/google-meet.svg"), "utf8");
    expect(favicon).toBe(meetIcon);
  });
});
