# ToggleGroup

## Use case

Use for selecting one or multiple pressed options. Use the Root `type="single" | "multiple"` and value/defaultValue, and give the group and each Item an identifiable accessible name.

Avoid: prefer RadioGroup when submitting mutually exclusive form answers.

## Public API

`ToggleGroup`, `ToggleGroupItem`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/ToggleGroup/` for exact types and defaults.

## Minimal example

```tsx
<ToggleGroup type="single" value={view} onValueChange={setView}><ToggleGroupItem value="list">List</ToggleGroupItem></ToggleGroup>
```

See `ui/src/components/ToggleGroup/ToggleGroup.stories.tsx` for states and compositions.
