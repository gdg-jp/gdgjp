import { renderToStaticMarkup } from "react-dom/server";
import { jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { Icons } from "./Icons";
const wikiIconNames = [
  "AlertCircle",
  "AlertTriangle",
  "Archive",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUpRight",
  "Bell",
  "BellDot",
  "BellOff",
  "CalendarDays",
  "ChartPie",
  "Check",
  "CheckCircle2",
  "ChevronDown",
  "ChevronLeft",
  "ChevronRight",
  "Clipboard",
  "Clock",
  "Copy",
  "ExternalLink",
  "FileInput",
  "FileQuestion",
  "FileText",
  "Folder",
  "FolderOpen",
  "Globe",
  "Globe2",
  "Hash",
  "History",
  "Home",
  "LayoutList",
  "Link",
  "Link2",
  "List",
  "ListChecks",
  "ListFilter",
  "ListTodo",
  "Loader2",
  "LoaderCircle",
  "LockKeyhole",
  "MessageSquare",
  "Moon",
  "MoreHorizontal",
  "MoveHorizontal",
  "PanelLeft",
  "PanelLeftClose",
  "Pencil",
  "Plus",
  "RefreshCw",
  "RotateCcw",
  "Send",
  "ServerCrash",
  "Settings",
  "Share2",
  "Smile",
  "Star",
  "Sun",
  "Tag",
  "Trash2",
  "Type",
  "Upload",
  "UserRound",
  "UsersRound",
  "X",
];
describe("Icons", () => {
  it("renders a lucide-animated icon through the public wrapper", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsx(Icons, {
        name: "Heart",
        "aria-label": "\u304A\u6C17\u306B\u5165\u308A",
        "data-testid": "favorite-icon",
      }),
    );
    expect(markup).toContain('class="gdg-icons"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="\u304A\u6C17\u306B\u5165\u308A"');
    expect(markup).toContain('data-testid="favorite-icon"');
    expect(markup).toContain('width="24"');
  });
  it("accepts the library icon suffix and preserves decorative attributes", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsx(Icons, {
        name: "SparklesIcon",
        size: 18,
        "aria-hidden": "true",
        title: "\u88C5\u98FE",
      }),
    );
    expect(markup).toContain('width="18"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('title="\u88C5\u98FE"');
    expect(markup).not.toContain('role="img"');
  });
  it("resolves every Wiki inventory icon through one public entry point", () => {
    for (const name of wikiIconNames) {
      const markup = renderToStaticMarkup(
        /* @__PURE__ */ jsx(Icons, { name, "aria-hidden": "true", size: 18 }),
      );
      expect(markup).toContain('class="gdg-icons"');
      expect(markup).toContain('width="18"');
    }
    const suffixed = renderToStaticMarkup(
      /* @__PURE__ */ jsx(Icons, { name: "AlertCircleIcon", "aria-hidden": "true" }),
    );
    expect(suffixed).toContain('class="gdg-icons"');
  });
  it("adapts static icons without exposing a second accessible graphic", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsx(Icons, {
        name: "Star",
        "aria-label": "\u304A\u6C17\u306B\u5165\u308A",
        strokeWidth: 1.5,
        style: { color: "red" },
        "data-testid": "static-icon",
      }),
    );
    expect(markup).toContain('class="gdg-icons"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="\u304A\u6C17\u306B\u5165\u308A"');
    expect(markup).toContain('data-testid="static-icon"');
    expect(markup).toContain("stroke-width:1.5");
    expect(markup).toContain('focusable="false"');
    expect(markup).toContain('aria-hidden="true"');
  });
  it("fails clearly for an unknown icon name", () => {
    const unknownName = "NotAnIcon";
    expect(() => renderToStaticMarkup(/* @__PURE__ */ jsx(Icons, { name: unknownName }))).toThrow(
      'Unknown icon "NotAnIcon"',
    );
  });
});
