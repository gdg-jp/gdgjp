# Empty

## Use case

Compose a flexible empty state with an icon/media, title, description, and action. Explain why it is empty and what the user can do next.

Avoid: flattening loading, permission errors, and network errors into “no data.”

## Public API

`Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`. Check `ui/src/components/Empty/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Empty><EmptyHeader><EmptyTitle>No events</EmptyTitle><EmptyDescription>Create your first event.</EmptyDescription></EmptyHeader><EmptyContent><Button>Create</Button></EmptyContent></Empty>
```

See `ui/src/components/Empty/Empty.stories.tsx` for states, compositions, and narrow-width layouts.
