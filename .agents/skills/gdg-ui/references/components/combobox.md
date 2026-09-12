# Combobox

## Use case

Use for searchable selection. Manage value/open and change events at the Root, and compose Trigger, Content, Input, List, and Item. Filter the input query against each Item's `value` and `keywords`; the app owns remote search and domain-data fetching. Always provide an empty state.

Avoid: using it for a simple small set of choices or a command-execution UI.

## Public API

`Combobox`, `ComboboxTrigger`, `ComboboxContent`, `ComboboxInput`, `ComboboxList`, `ComboboxEmpty`, `ComboboxGroup`, `ComboboxItem`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Combobox/` for exact types and defaults.

## Minimal example

```tsx
<Combobox><ComboboxTrigger>Select a venue</ComboboxTrigger><ComboboxContent><ComboboxInput placeholder="Search" /><ComboboxList><ComboboxEmpty>No matches</ComboboxEmpty><ComboboxItem value="a">Venue A</ComboboxItem></ComboboxList></ComboboxContent></Combobox>
```

See `ui/src/components/Combobox/Combobox.stories.tsx` for states and compositions.
