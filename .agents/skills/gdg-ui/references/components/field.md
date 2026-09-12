# Field

## Use case

Compose multiple fields or a complex form layout. Explicitly structure semantic `fieldset/legend` elements with labels, descriptions, and errors. Use FormField when a single control needs automatic ID association.

Avoid: losing form relationships in a collection of purely visual divs.

## Public API

`FieldSet`, `FieldLegend`, `FieldGroup`, `Field`, `FieldContent`, `FieldLabel`, `FieldTitle`, `FieldDescription`, `FieldSeparator`, `FieldError`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Field/` for exact types and defaults.

## Minimal example

```tsx
<FieldSet><FieldLegend>Contact</FieldLegend><FieldGroup><Field><FieldLabel htmlFor="email">Email</FieldLabel><Input id="email" /></Field></FieldGroup></FieldSet>
```

See `ui/src/components/Field/Field.stories.tsx` for states and compositions.
