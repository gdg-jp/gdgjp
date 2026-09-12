# Switch

## Use case

Use for a binary setting whose change takes effect immediately. Preserve checked/defaultChecked, onCheckedChange, name, required, disabled, and ref, and associate a visible label.

Avoid: use Checkbox for a form field that does not take effect until a Save button or for consent.

## Public API

`Switch`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Switch/` for exact types and defaults.

## Minimal example

```tsx
<label><Switch checked={enabled} onCheckedChange={setEnabled} /> Enable notifications</label>
```

See `ui/src/components/Switch/Switch.stories.tsx` for states and compositions.
