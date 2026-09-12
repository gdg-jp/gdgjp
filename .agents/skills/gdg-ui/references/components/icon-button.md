# IconButton

## Use case

Use for an icon-only action. Apply the same variant/size concepts as Button, and require `aria-label`. Child icons should generally be `aria-hidden`.

Avoid: reducing a labeled action or explanation to an icon alone.

## Public API

`IconButton`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/IconButton/` for exact types and defaults.

## Minimal example

```tsx
<IconButton aria-label="Edit"><Pencil aria-hidden="true" /></IconButton>
```

See `ui/src/components/IconButton/IconButton.stories.tsx` for states and compositions.
