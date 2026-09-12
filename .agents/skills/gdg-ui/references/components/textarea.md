# Textarea

## Use case

Use for a multiline native textarea. Preserve the same FormField states and native props/ref as Input, including the distinction between readOnly and disabled. Check the layout with long text and Japanese line breaks.

Avoid: use Input for single-line values or search. This is not a substitute for contenteditable.

## Public API

`Textarea`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Textarea/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Description"><Textarea name="description" rows={5} /></FormField>
```

See `ui/src/components/Textarea/Textarea.stories.tsx` for states and compositions.
