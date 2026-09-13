import { renderToStaticMarkup } from "react-dom/server";
import { jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { DatePicker } from "./DatePicker";
describe("DatePicker", () => {
  it("treats value={undefined} as a controlled empty value", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsx(DatePicker, {
        "aria-label": "\u671F\u9650",
        value: void 0,
        defaultValue: new Date(2026, 8, 12, 12),
        calendarProps: { defaultMonth: new Date(2026, 8, 1, 12) },
      }),
    );
    expect(markup).toContain('aria-label="\u671F\u9650"');
    expect(markup).not.toContain('value="2026/09/12"');
  });
  it("keeps omitted value uncontrolled with defaultValue", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsx(DatePicker, {
        "aria-label": "\u671F\u9650",
        defaultValue: new Date(2026, 8, 12, 12),
      }),
    );
    expect(markup).toContain('value="2026/09/12"');
  });
});
