# Item

## Use case

Use for a rich row in a list. Keep media, title, description, and actions in one reading group, and make the interactive target clear.

Avoid: using it for comparison data that needs table semantics or creating nested interaction between the whole row and an internal button.

## Public API

`Item`, `ItemGroup`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemHeader`, `ItemFooter`, `ItemSeparator`. Check `ui/src/components/Item/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Item><ItemContent><ItemTitle>DevFest</ItemTitle><ItemDescription>September 26</ItemDescription></ItemContent><ItemActions><Button>Open</Button></ItemActions></Item>
```

See `ui/src/components/Item/Item.stories.tsx` for states, compositions, and narrow-width layouts.
