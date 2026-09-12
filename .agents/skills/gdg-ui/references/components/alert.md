# Alert

## Use case

Use for persistent inline feedback. The default `tone` is info; neutral/info/success/warning use `role="status"`, while danger uses `role="alert"`. Keep the message and its resolution close together with the required `title` and children.

Avoid: using it instead of a Toast for a brief action-completion message or instead of an AlertDialog for a destructive confirmation.

## Public API

`Alert`. Check `ui/src/components/Alert/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Alert tone="danger" title="Could not save">Check the form values.</Alert>
```

See `ui/src/components/Alert/Alert.stories.tsx` for states, compositions, and narrow-width layouts.
