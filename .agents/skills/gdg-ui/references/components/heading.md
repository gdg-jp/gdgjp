# Heading

## Use case

Use `level` 1–6 to output a semantic heading and align visual style with the document hierarchy. Preserve native heading props.

Avoid: skipping levels based only on visual size, or using it to emphasize ordinary text.

## Public API

`Heading`. Check `ui/src/components/Heading/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Heading level={1}>Event management</Heading>
```

See `ui/src/components/Heading/Heading.stories.tsx` for states, compositions, and narrow-width layouts.
