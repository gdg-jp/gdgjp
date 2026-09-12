import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as UI from "./index";

describe("public contracts", () => {
  it("exports every planned primary component", () => {
    const planned = `
      Button IconButton Link Text Heading Stack Inline Card Separator Badge Avatar Input Textarea
      FormField Checkbox RadioGroup Switch Select Dialog AlertDialog Sheet Popover DropdownMenu Tooltip
      Alert Toaster Spinner Skeleton EmptyState Table Pagination Tabs Accordion Breadcrumb AppShell
      SidebarNav PageHeader Toolbar ThemeProvider ThemeToggle useTheme
      AspectRatio Attachment Bubble ButtonGroup Calendar Carousel Chart Collapsible Combobox Command
      ContextMenu DataTable DatePicker Direction Drawer Empty Field HoverCard InputGroup InputOTP Item
      Kbd Label Marker Menubar Message MessageScroller NativeSelect NavigationMenu Progress Questionnaire
      Icons QuestionnaireNew Resizable ScrollArea Sidebar Slider Toast Toggle ToggleGroup Typography
    `
      .split(/\s+/)
      .filter(Boolean);
    for (const name of planned) expect(UI).toHaveProperty(name);
  });
  it("has no blanket transitions or application dependencies", () => {
    expect(readFileSync(new URL("./styles/components.css", import.meta.url), "utf8")).not.toMatch(
      /transition:\s*all/,
    );
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies).not.toHaveProperty("react-router");
    expect(pkg.dependencies).not.toHaveProperty("@gdgjp/gdg-lib");
  });
  it("couples the shared corner shape to every GDG radius scope", () => {
    const tokens = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");
    const components = readFileSync(new URL("./styles/components.css", import.meta.url), "utf8");
    expect(tokens).toContain("--gdg-corner-shape: squircle;");
    expect(components).toContain("corner-shape: var(--gdg-corner-shape);");
    expect(components).toContain('[class^="gdg-"] *,');
    expect(components).toContain('[class*=" gdg-"] *');
    expect(components).toContain("corner-shape is not inherited");
    expect(components).toContain("corner-shape: round;");
  });
  it("uses a muted blue secondary with a distinct hover color", () => {
    const tokens = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");
    expect(tokens).toContain("--gdg-secondary: #5d899d;");
    expect(tokens).toContain("--gdg-on-secondary: var(--gdg-white);");
    expect(tokens).toContain("--gdg-secondary-hover: #6b9aae;");
    expect(tokens).toContain("--gdg-neutral: #e7e7e7;");
    expect(tokens).toContain("--gdg-neutral: #303030;");
  });

  it("renders newly added compositions in SSR", () => {
    const markup = renderToStaticMarkup(
      <main>
        <UI.AspectRatio ratio={1}>
          <img alt="プレースホルダー" src="/placeholder.png" />
        </UI.AspectRatio>
        <UI.Attachment state="uploading">
          <UI.AttachmentContent>
            <UI.AttachmentTitle>資料.pdf</UI.AttachmentTitle>
          </UI.AttachmentContent>
        </UI.Attachment>
        <UI.Bubble>
          <UI.BubbleContent>こんにちは</UI.BubbleContent>
        </UI.Bubble>
        <UI.InputOTP defaultValue="12" maxLength={4}>
          <UI.InputOTPGroup>
            <UI.InputOTPSlot index={0} />
            <UI.InputOTPSlot index={1} />
          </UI.InputOTPGroup>
        </UI.InputOTP>
        <UI.Questionnaire items={[{ name: "format" }]}>
          <UI.QuestionnaireItem name="format">
            <UI.QuestionnaireChoice value="online">オンライン</UI.QuestionnaireChoice>
          </UI.QuestionnaireItem>
        </UI.Questionnaire>
      </main>,
    );
    expect(markup).toContain("gdg-aspect-ratio");
    expect(markup).toContain("gdg-attachment-title");
    expect(markup).toContain("gdg-bubble-content");
    expect(markup).toContain('value="12"');
    expect(markup).toContain("オンライン");
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

it("keeps the documented white-on-secondary control contrast", () => {
  for (const background of ["#5d899d", "#6b9aae"])
    expect(contrast("#ffffff", background)).toBeGreaterThanOrEqual(3);
});
