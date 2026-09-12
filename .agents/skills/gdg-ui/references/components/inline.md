# Inline

## Use case

Compose related controls and metadata in a row that wraps at narrow widths. The default gap is 12px. Preserve order and reading order in the DOM.

Avoid: using it for extensive navigation, data rows that depend on horizontal scrolling, or changing visual order alone.

## Public API

`Inline`. Check `ui/src/components/Inline/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Inline><Badge>Published</Badge><Text size="sm">September 26</Text></Inline>
```

See `ui/src/components/Inline/Inline.stories.tsx` for states, compositions, and narrow-width layouts.
