# Card

## Use case

Use as a raised clay surface for one group of information. It accepts native div props and refs; organize its contents with Stack/Inline/Separator. Use 24px padding on desktop and 16px at narrow widths as a baseline.

Avoid: stacking Cards inside Cards or enclosing every section in a surface. For an interactive card, make the semantics of its internal button or link explicit.

## Public API

`Card`. Check `ui/src/components/Card/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Card><Stack><Heading level={2}>Event</Heading><Text>Details</Text></Stack></Card>
```

See `ui/src/components/Card/Card.stories.tsx` for states, compositions, and narrow-width layouts.
