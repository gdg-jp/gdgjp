import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "../Input";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("associates field labels, descriptions and errors with SSR-stable ids", () => {
    const html = renderToStaticMarkup(
      <FormField id="email" label="メール" description="連絡先" error="入力してください" required>
        <Input />
      </FormField>,
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('aria-describedby="email-help email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });
});
