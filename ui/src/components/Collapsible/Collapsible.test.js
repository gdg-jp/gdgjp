import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./Collapsible";
describe("Collapsible", () => {
  it("keeps closed content mounted for the exit transition", () => {
    const html = renderToStaticMarkup(
      _jsxs(Collapsible, {
        children: [
          _jsx(CollapsibleTrigger, { children: "\u8A73\u7D30" }),
          _jsx(CollapsibleContent, { children: "\u8AAC\u660E" }),
        ],
      }),
    );
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('class="gdg-collapsible-content"');
    expect(html).toContain("説明");
  });
});
