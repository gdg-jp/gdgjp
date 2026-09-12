# Text

## Use case

Use for body and supporting text. `size` is xs/sm/md, and `tone` is default/muted. It accepts native paragraph props. Do not make information hierarchy depend on tone and size alone.

Avoid: replacing semantic components for headings, labels, links, or error messages.

## Public API

`Text`. Check `ui/src/components/Text/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Text size="sm" tone="muted">Last updated 5 minutes ago</Text>
```

See `ui/src/components/Text/Text.stories.tsx` for states, compositions, and narrow-width layouts.
