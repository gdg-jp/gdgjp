import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "./Combobox";

describe("Combobox", () => {
  it("keeps the existing filtered single-select SSR contract", () => {
    const markup = renderToStaticMarkup(
      <Combobox defaultOpen value="osaka">
        <ComboboxInput placeholder="検索" />
        <ComboboxList aria-label="候補">
          <ComboboxItem value="tokyo">Tokyo</ComboboxItem>
          <ComboboxItem value="osaka">Osaka</ComboboxItem>
          <ComboboxEmpty />
        </ComboboxList>
      </Combobox>,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-controls="gdg-combobox-list-');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('role="option"');
    expect(markup).toContain('aria-selected="true"');
  });

  it("does not client-filter remote results when shouldFilter is false", () => {
    const markup = renderToStaticMarkup(
      <Combobox defaultOpen query="remote" shouldFilter={false} closeOnSelect={false}>
        <ComboboxInput />
        <ComboboxList aria-label="Remote candidates">
          <ComboboxItem value="server-result">Server result</ComboboxItem>
          <ComboboxEmpty />
        </ComboboxList>
      </Combobox>,
    );

    expect(markup).toContain("Server result");
    expect(markup).not.toContain('data-combobox-hidden="true"');
  });

  it("represents controlled empty values without a selected indicator", () => {
    const markup = renderToStaticMarkup(
      <Combobox value={null} query="">
        <ComboboxInput />
        <ComboboxList>
          <ComboboxItem value="one">One</ComboboxItem>
        </ComboboxList>
      </Combobox>,
    );

    expect(markup).not.toContain('aria-selected="true"');
  });
});
