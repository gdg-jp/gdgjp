# Separator

## Use case

Use for a semantic or visual division between content. Use Radix orientation/decorative and ref, and set decorative to false when the separator communicates structure.

Avoid: using it only to adjust spacing or as an unrelated decorative line.

## Public API

`Separator`. Check `ui/src/components/Separator/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Separator orientation="horizontal" decorative />
```

See `ui/src/components/Separator/Separator.stories.tsx` for states, compositions, and narrow-width layouts.
