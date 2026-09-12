# Label

## Use case

Use this styled Radix Label primitive. Associate it with a native control through `htmlFor`, and preserve native props and refs. Prefer FormField when it can handle a single input.

Avoid: using a placeholder instead of a label. Use Text for decorative text that does not need a label.

## Public API

`Label`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Label/` for exact types and defaults.

## Minimal example

```tsx
<Label htmlFor="title">Title</Label>
```

See `ui/src/components/Label/Label.stories.tsx` for states and compositions.
