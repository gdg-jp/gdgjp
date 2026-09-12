# PageHeader

## Use case

Bring a page title, description, and actions together in one header. The title must match the page hierarchy, and at narrow widths the actions must be allowed to wrap.

Avoid: using it only as a section heading or toolbar, or using it as a place for multiple primary actions.

## Public API

`PageHeader`. Check `ui/src/components/PageHeader/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<PageHeader title="Events" description="Manage event details" actions={<Button>Create</Button>} />
```

See `ui/src/components/PageHeader/PageHeader.stories.tsx` for states, compositions, and narrow-width layouts.
