import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Calendar } from "./Calendar";

const selectedDate = new Date(2026, 8, 12, 12);

describe("Calendar", () => {
  it("treats selected={undefined} as a controlled empty selection", () => {
    const markup = renderToStaticMarkup(
      <Calendar
        defaultMonth={new Date(2026, 8, 1, 12)}
        defaultSelected={selectedDate}
        selected={undefined}
      />,
    );

    expect(markup).not.toContain('aria-pressed="true"');
  });

  it("retains defaultSelected when selected is omitted", () => {
    const markup = renderToStaticMarkup(
      <Calendar defaultMonth={new Date(2026, 8, 1, 12)} defaultSelected={selectedDate} />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-date="2026-09-12"');
  });
});
