# NativeSelect

## Use case

Use for lightweight single selection where a native select is appropriate. Keep name, value/defaultValue, required, disabled, and multiple under the HTML contract, and use Option/OptGroup as children.

Avoid: when rich options, search, or a custom popup is needed; use Select or Combobox instead.

## Public API

`NativeSelect`, `NativeSelectOption`, `NativeSelectOptGroup`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/NativeSelect/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Region"><NativeSelect name="region"><NativeSelectOption value="jp">Japan</NativeSelectOption></NativeSelect></FormField>
```

See `ui/src/components/NativeSelect/NativeSelect.stories.tsx` for states and compositions.
