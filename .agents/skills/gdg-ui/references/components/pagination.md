# Pagination

## Use case

Use for navigation across multiple pages. Use the current props for the current page, total pages, and change callback, and communicate the current location and disabled boundaries to assistive technology. The app owns URL synchronization.

Avoid: mixing it up with a simple previous/next action or infinite scroll.

## Public API

`Pagination`. Check `ui/src/components/Pagination/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
```

See `ui/src/components/Pagination/Pagination.stories.tsx` for states, compositions, and narrow-width layouts.
