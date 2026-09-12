import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DropdownMenuLabel } from "./DropdownMenu";

describe("DropdownMenu", () => {
  it("gives labels the same content inset as menu items", () => {
    const html = renderToStaticMarkup(
      <DropdownMenuLabel className="custom-label">イベント</DropdownMenuLabel>,
    );

    expect(html).toContain('class="gdg-menu-label custom-label"');
  });
});
