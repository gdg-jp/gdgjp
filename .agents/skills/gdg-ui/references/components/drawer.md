# Drawer

## Use case

Use primarily as a supporting surface that appears from the bottom on mobile. Compose Title/Description, a decorative Handle, and footer actions, and handle Dialog-derived open state, close, and focus. The current public API does not provide drag gestures.

Avoid: using it as a regular desktop modal, permanent navigation, or a long page-content container. For an edge context, compare it with Sheet.

## Public API

`Drawer`, `DrawerTrigger`, `DrawerClose`, `DrawerPortal`, `DrawerOverlay`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription`, `DrawerHandle`. Check `ui/src/components/Drawer/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Drawer><DrawerTrigger asChild><Button>Filter</Button></DrawerTrigger><DrawerContent><DrawerHeader><DrawerTitle>Filter</DrawerTitle><DrawerDescription>Choose the criteria.</DrawerDescription></DrawerHeader><DrawerFooter><DrawerClose>Close</DrawerClose></DrawerFooter></DrawerContent></Drawer>
```

See `ui/src/components/Drawer/Drawer.stories.tsx` for states and compositions.
