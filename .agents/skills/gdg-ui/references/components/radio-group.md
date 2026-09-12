# RadioGroup

## Use case

Choose one option from a small set. Manage controlled/uncontrolled value, name, required, disabled, and orientation at the Root, and label the group and each Item. Let Radix handle arrow-key movement.

Avoid: putting multiple independent inputs in one FormField. Use Select when there are many options.

## Public API

`RadioGroup`, `RadioGroupItem`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/RadioGroup/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Event format"><RadioGroup name="format" defaultValue="venue"><RadioGroupItem id="venue" value="venue" /><label htmlFor="venue">Venue</label></RadioGroup></FormField>
```

See `ui/src/components/RadioGroup/RadioGroup.stories.tsx` for states and compositions.
