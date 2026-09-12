import { renderToStaticMarkup } from "react-dom/server";
import { jsx as _jsx } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { Input } from "../Input";
import { FormField } from "./FormField";
describe("FormField", () => {
  it("associates field labels, descriptions and errors with SSR-stable ids", () => {
    const html = renderToStaticMarkup(
      _jsx(FormField, {
        id: "email",
        label: "\u30E1\u30FC\u30EB",
        description: "\u9023\u7D61\u5148",
        error: "\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044",
        required: true,
        children: _jsx(Input, {}),
      }),
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('aria-describedby="email-help email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });
});
