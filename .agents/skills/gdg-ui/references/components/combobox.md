# Combobox

## Use case

Use for searchable selection. Manage value/open/query/active events at the Root, and compose Trigger, Content, Input, List, and Item. By default the input query is filtered against each Item's `value` and `keywords`; the app owns remote search and domain-data fetching. Always provide an empty state.

Avoid: using it for a simple small set of choices or a command-execution UI.

## Public API

`Combobox`, `ComboboxTrigger`, `ComboboxContent`, `ComboboxInput`, `ComboboxList`, `ComboboxEmpty`, `ComboboxGroup`, `ComboboxItem`. Root props include `query`/`defaultQuery`/`onQueryChange`, `activeValue`/`defaultActiveValue`/`onActiveValueChange`, `shouldFilter` (default `true`), and `closeOnSelect` (default `true`). `value` and `defaultValue` accept `null` as an explicit empty selection. An omitted prop is uncontrolled; `query=""` and `activeValue={null}` are controlled empty values. Do not switch controlledness after mount. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Combobox/` for exact types and defaults.

## Minimal example

```tsx
<Combobox><ComboboxTrigger>Select a venue</ComboboxTrigger><ComboboxContent><ComboboxInput placeholder="Search" /><ComboboxList><ComboboxEmpty>No matches</ComboboxEmpty><ComboboxItem value="a">Venue A</ComboboxItem></ComboboxList></ComboboxContent></Combobox>
```

The input retains DOM focus while the active enabled option is exposed through `aria-activedescendant`; options use stable IDs and `tabIndex={-1}`. ArrowUp/ArrowDown/Home/End stop at the collection ends, Enter ignores stale or disabled options, Escape closes only the popup, and Tab uses the browser's normal focus order. Use `shouldFilter={false}` for consumer-owned remote results and `closeOnSelect={false}` for continued/multiple selection; fetching, debouncing, ACL, and chips remain in the app.

See `ui/src/components/Combobox/Combobox.stories.tsx` for states and compositions.
