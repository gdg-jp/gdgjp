import { renderToStaticMarkup } from "react-dom/server";
import { jsx, jsxs } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "./Combobox";
describe("Combobox", () => {
  it("keeps the existing filtered single-select SSR contract", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsxs(Combobox, {
        defaultOpen: true,
        value: "osaka",
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "\u691C\u7D22" }),
          /* @__PURE__ */ jsxs(ComboboxList, {
            "aria-label": "\u5019\u88DC",
            children: [
              /* @__PURE__ */ jsx(ComboboxItem, { value: "tokyo", children: "Tokyo" }),
              /* @__PURE__ */ jsx(ComboboxItem, { value: "osaka", children: "Osaka" }),
              /* @__PURE__ */ jsx(ComboboxEmpty, {}),
            ],
          }),
        ],
      }),
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-controls="gdg-combobox-list-');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('role="option"');
    expect(markup).toContain('aria-selected="true"');
  });
  it("does not client-filter remote results when shouldFilter is false", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsxs(Combobox, {
        defaultOpen: true,
        query: "remote",
        shouldFilter: false,
        closeOnSelect: false,
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, {}),
          /* @__PURE__ */ jsxs(ComboboxList, {
            "aria-label": "Remote candidates",
            children: [
              /* @__PURE__ */ jsx(ComboboxItem, {
                value: "server-result",
                children: "Server result",
              }),
              /* @__PURE__ */ jsx(ComboboxEmpty, {}),
            ],
          }),
        ],
      }),
    );
    expect(markup).toContain("Server result");
    expect(markup).not.toContain('data-combobox-hidden="true"');
  });
  it("represents controlled empty values without a selected indicator", () => {
    const markup = renderToStaticMarkup(
      /* @__PURE__ */ jsxs(Combobox, {
        value: null,
        query: "",
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, {}),
          /* @__PURE__ */ jsx(ComboboxList, {
            children: /* @__PURE__ */ jsx(ComboboxItem, { value: "one", children: "One" }),
          }),
        ],
      }),
    );
    expect(markup).not.toContain('aria-selected="true"');
  });
});
