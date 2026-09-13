import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DatePicker } from "./DatePicker";

describe("DatePicker", () => {
  it("treats value={undefined} as a controlled empty value", () => {
    const markup = renderToStaticMarkup(
      <DatePicker
        aria-label="期限"
        value={undefined}
        defaultValue={new Date(2026, 8, 12, 12)}
        calendarProps={{ defaultMonth: new Date(2026, 8, 1, 12) }}
      />,
    );

    expect(markup).toContain('aria-label="期限"');
    expect(markup).not.toContain('value="2026/09/12"');
  });

  it("keeps omitted value uncontrolled with defaultValue", () => {
    const markup = renderToStaticMarkup(
      <DatePicker aria-label="期限" defaultValue={new Date(2026, 8, 12, 12)} />,
    );

    expect(markup).toContain('value="2026/09/12"');
  });
});
