import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as UI from "./index";

describe("public contracts", () => {
  it("renders native button, loading state and disabled links on the server", () => {
    expect(renderToStaticMarkup(<UI.Button loading>保存</UI.Button>)).toMatch(/disabled=""/);
    expect(renderToStaticMarkup(<UI.Button loading>保存</UI.Button>)).toContain('aria-busy="true"');
    expect(
      renderToStaticMarkup(
        <UI.Button asChild disabled>
          <a href="/test">移動</a>
        </UI.Button>,
      ),
    ).toContain('aria-disabled="true"');
    expect(renderToStaticMarkup(<UI.Button>保存</UI.Button>)).toContain('type="button"');
  });
  it("associates field labels, descriptions and errors with SSR-stable ids", () => {
    const html = renderToStaticMarkup(
      <UI.FormField
        id="email"
        label="メール"
        description="連絡先"
        error="入力してください"
        required
      >
        <UI.Input />
      </UI.FormField>,
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('aria-describedby="email-help email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });
  it("exports every planned primary component", () => {
    for (const name of "Button IconButton Link Text Heading Stack Inline Card Separator Badge Avatar Input Textarea FormField Checkbox RadioGroup Switch Select Dialog AlertDialog Sheet Popover DropdownMenu Tooltip Alert Toaster Spinner Skeleton EmptyState Table Pagination Tabs Accordion Breadcrumb AppShell SidebarNav PageHeader Toolbar ThemeProvider ThemeToggle useTheme".split(
      " ",
    ))
      expect(UI).toHaveProperty(name);
  });
  it("has no blanket transitions or application dependencies", () => {
    expect(readFileSync(new URL("./styles/components.css", import.meta.url), "utf8")).not.toMatch(
      /transition:\s*all/,
    );
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies).not.toHaveProperty("react-router");
    expect(pkg.dependencies).not.toHaveProperty("@gdgjp/gdg-lib");
  });
});
function luminance(hex: string) {
  const rgb = (hex.replace("#", "").match(/../g) ?? [])
    .map((x) => Number.parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
it("meets contrast for brand blue and semantic text pairs", () => {
  for (const [fg, bg] of [
    ["#141414", "#4285f4"],
    ["#606060", "#f0f0f0"],
    ["#b0b0b0", "#1e1e1e"],
    ["#185abc", "#ffffff"],
    ["#8ab4f8", "#141414"],
    ["#176b35", "#e6f4ea"],
    ["#765000", "#fef3d1"],
    ["#b3261e", "#fce8e6"],
  ])
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
});
