# Skeleton

## Use case

Use as a decorative placeholder that reserves layout. Keep it close in size to the real content, and announce loading with the parent's `aria-busy`, a labelled Spinner, or a status message.

Avoid: using it to display errors or empty states, as the only loading announcement, or as an excessive full-screen shimmer.

## Public API

`Skeleton`. Check `ui/src/components/Skeleton/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<section aria-busy="true" aria-label="Loading events"><Skeleton className="h-24" /></section>
```

See `ui/src/components/Skeleton/Skeleton.stories.tsx` for states, compositions, and narrow-width layouts.
