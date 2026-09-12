import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./Checkbox";
describe("Checkbox", () => {
  it("keeps its indicator mounted for checked and unchecked transitions", () => {
    const html = renderToStaticMarkup(_jsx(Checkbox, {}));
    expect(html).toContain('class="gdg-checkbox-indicator"');
    expect(html).toContain('data-state="unchecked"');
  });
  it("renders the indicator state for an indeterminate checkbox", () => {
    const html = renderToStaticMarkup(_jsx(Checkbox, { defaultChecked: "indeterminate" }));
    expect(html).toContain('class="gdg-checkbox-indicator"');
    expect(html).toContain('data-state="indeterminate"');
  });
});
