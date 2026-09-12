# InputGroup

## Use case

Combine a prefix, suffix, and action in one inset surface. Use the dedicated Input/Textarea/Button parts, and preserve the primary input's label and the accessible name of actions inside the group.

Avoid: using it as a toolbar packed with unrelated controls or as a substitute for multiple fields.

## Public API

`InputGroup`, `InputGroupAddon`, `InputGroupText`, `InputGroupInput`, `InputGroupTextarea`, `InputGroupButton`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/InputGroup/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Search"><InputGroup><InputGroupInput name="q" /><InputGroupButton aria-label="Search">Search</InputGroupButton></InputGroup></FormField>
```

See `ui/src/components/InputGroup/InputGroup.stories.tsx` for states and compositions.
