# FormField

## Use case

Associate one input with its label/description/error. `id` and `label` are primary props, and `required/disabled/error` are propagated to the child. Put an explicit ID on FormField; the app owns `name`, validation, and submission.

Avoid: wrapping multiple independent inputs or an entire fieldset in one FormField. Use Field for a composite form section.

## Public API

`FormField`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/FormField/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Display name" description="Shown to attendees" error={error} required><Input name="displayName" /></FormField>
```

See `ui/src/components/FormField/FormField.stories.tsx` for states and compositions.
