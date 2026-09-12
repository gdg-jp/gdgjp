# Select

## Use case

Use for single selection from many options. Use value/defaultValue, onValueChange, open/defaultOpen, name, required, and disabled on the Root. Put a label on the Trigger and Items in Content; let Radix handle keyboard behavior and the portal.

Avoid: choose Combobox for free-form input or search, RadioGroup for a small set of options, and NativeSelect when native behavior is sufficient.

## Public API

`Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectTrigger`, `SelectValue`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Select/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Chapter" required><Select name="chapter"><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="tokyo">Tokyo</SelectItem></SelectContent></Select></FormField>
```

See `ui/src/components/Select/Select.stories.tsx` for states and compositions.
