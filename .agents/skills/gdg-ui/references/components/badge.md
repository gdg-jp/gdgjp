# Badge

## Use case

Use for a short category or status label. tone is neutral/info/success/warning/danger. Combine the pill surface with text and keep children short.

Avoid: using it as an action button, for long text, or for a critical state represented only by a number or color.

## Public API

`Badge`, `Tone`. Check `ui/src/components/Badge/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Badge tone="success">Published</Badge>
```

See `ui/src/components/Badge/Badge.stories.tsx` for states, compositions, and narrow-width layouts.
