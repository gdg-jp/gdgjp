# Input

## Use case

Use the native input props/ref and FormField context. Preserve required, disabled, `aria-invalid`, and `aria-describedby`; keep readOnly content selectable and copyable. The app specifies type, name, autocomplete, and value management.

Avoid: creating a custom div input or a pseudo-control that depends on onClick.

## Public API

`Input`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Input/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Email"><Input name="email" type="email" autoComplete="email" /></FormField>
```

See `ui/src/components/Input/Input.stories.tsx` for states and compositions.
