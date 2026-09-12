# Toggle

## Use case

Use for a binary button with a pressed state. Preserve Radix `pressed/defaultPressed/onPressedChange`, ref, and keyboard contract. Specify variant/size and an accessible name.

Avoid: use Switch for an on/off setting that changes immediately and Checkbox for form consent.

## Public API

`Toggle`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Toggle/` for exact types and defaults.

## Minimal example

```tsx
<Toggle aria-label="Bold" pressed={bold} onPressedChange={setBold}>B</Toggle>
```

See `ui/src/components/Toggle/Toggle.stories.tsx` for states and compositions.
