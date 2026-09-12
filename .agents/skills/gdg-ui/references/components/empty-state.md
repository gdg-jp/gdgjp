# EmptyState

## Use case

Use for a concise empty state that accepts a title, description, and optional action. Choose it when complex media or layout is unnecessary.

Avoid: using it instead of loading or error feedback, or turning it into a long onboarding document.

## Public API

`EmptyState`. Check `ui/src/components/EmptyState/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<EmptyState title="No links" description="Created links will appear here." action={<Button>Create</Button>} />
```

See `ui/src/components/EmptyState/EmptyState.stories.tsx` for states, compositions, and narrow-width layouts.
