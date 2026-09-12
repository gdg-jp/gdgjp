# Tabs

## Use case

Switch between parallel views in the same context. Manage value/defaultValue/onValueChange and orientation/activationMode at the Root, and match Trigger values to Content values. Let Radix handle keyboard navigation and selected state.

Avoid: using it for primary navigation between separate URL pages, step order, or an accordion whose content should remain preserved.

## Public API

`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. Check `ui/src/components/Tabs/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="staff">Staff</TabsTrigger></TabsList><TabsContent value="overview">Overview content</TabsContent><TabsContent value="staff">Staff content</TabsContent></Tabs>
```

See `ui/src/components/Tabs/Tabs.stories.tsx` for states and compositions.
