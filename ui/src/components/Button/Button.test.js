import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
describe("Button", () => {
  it("renders native button, loading state and disabled links on the server", () => {
    expect(renderToStaticMarkup(_jsx(Button, { loading: true, children: "\u4FDD\u5B58" }))).toMatch(
      /disabled=""/,
    );
    expect(
      renderToStaticMarkup(_jsx(Button, { loading: true, children: "\u4FDD\u5B58" })),
    ).toContain('aria-busy="true"');
    expect(
      renderToStaticMarkup(
        _jsx(Button, {
          asChild: true,
          disabled: true,
          children: _jsx("a", { href: "/test", children: "\u79FB\u52D5" }),
        }),
      ),
    ).toContain('aria-disabled="true"');
    expect(renderToStaticMarkup(_jsx(Button, { children: "\u4FDD\u5B58" }))).toContain(
      'type="button"',
    );
  });
});
