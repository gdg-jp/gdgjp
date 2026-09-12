# Table

## Use case

Use as a horizontal scroll surface around a native table composition. The consumer writes caption, thead/tbody, and `th scope`, and can change the scroll-region name with `scrollLabel`.

Avoid: using it as a layout table or for styling a div grid. Do not let the whole page overflow at narrow widths.

## Public API

`Table`. Check `ui/src/components/Table/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Table scrollLabel="Attendee list"><caption>Attendees</caption><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td>Yamada</td></tr></tbody></Table>
```

See `ui/src/components/Table/Table.stories.tsx` for states, compositions, and narrow-width layouts.
