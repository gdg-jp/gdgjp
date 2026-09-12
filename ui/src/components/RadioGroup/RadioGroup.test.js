import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";
describe("RadioGroup", () => {
  it("keeps checked and unchecked indicators mounted for both transitions", () => {
    const html = renderToStaticMarkup(
      _jsxs(RadioGroup, {
        "aria-label": "\u53C2\u52A0\u65B9\u6CD5",
        defaultValue: "venue",
        children: [
          _jsx(RadioGroupItem, { value: "venue" }),
          _jsx(RadioGroupItem, { value: "online" }),
        ],
      }),
    );
    expect(html.match(/class="gdg-radio-indicator"/g)).toHaveLength(2);
    expect(html).toMatch(/data-state="checked"[^>]*class="gdg-radio-indicator"/);
    expect(html).toMatch(/data-state="unchecked"[^>]*class="gdg-radio-indicator"/);
  });
});
