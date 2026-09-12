# Checkbox

## Use case

Use for consent and multiple selection. Preserve Radix checked/defaultChecked (including `indeterminate`), onCheckedChange, name, required, disabled, and FormField context. Pair it with a visible label.

Avoid: using it for an immediately applied on/off setting or as a substitute for single selection.

## Public API

`Checkbox`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Checkbox/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Agree to the terms" required><Checkbox name="consent" /></FormField>
```

See `ui/src/components/Checkbox/Checkbox.stories.tsx` for states and compositions.
