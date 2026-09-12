# DataTable

## Use case

Use for a lightweight client-side table. Specify columns and data, caption, emptyMessage, getRowId, and onRowClick. A sortable column has accessor/accessorKey and is sorted with Japanese numeric localeCompare. Determine column-width ratios from the content.

Avoid: using it as a virtualized grid, for server pagination, or for complex cell editors. When rows are clickable, check for conflicts with interactive elements inside them.

## Public API

`DataTable`, `DataTableColumn` (generic type `DataTableColumn<T>`). Check `ui/src/components/DataTable/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<DataTable columns={[{ id: "name", header: "Name", accessorKey: "name", sortable: true }]} data={rows as Array<{ id: string; name: string }>} getRowId={(row) => row.id} />
```

See `ui/src/components/DataTable/DataTable.stories.tsx` for states, compositions, and narrow-width layouts.
