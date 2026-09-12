# Spinner

## Use case

Use as an indicator that announces work in progress. Provide a meaningful `label`, or pair it with the parent's `aria-busy` and a status message. When reduced motion stops rotation, retain the meaning of loading.

Avoid: replacing page content without explanation or displaying it indefinitely until completion.

## Public API

`Spinner`. Check `ui/src/components/Spinner/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Spinner label="Saving" />
```

See `ui/src/components/Spinner/Spinner.stories.tsx` for states, compositions, and narrow-width layouts.
