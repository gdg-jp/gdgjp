import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { DropdownMenuLabel } from "./DropdownMenu";
describe("DropdownMenu", () => {
  it("gives labels the same content inset as menu items", () => {
    const html = renderToStaticMarkup(
      _jsx(DropdownMenuLabel, { className: "custom-label", children: "\u30A4\u30D9\u30F3\u30C8" }),
    );
    expect(html).toContain('class="gdg-menu-label custom-label"');
  });
});
