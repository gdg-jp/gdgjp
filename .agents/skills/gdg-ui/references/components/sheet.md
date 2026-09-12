# Sheet

## Use case

Use for navigation or supporting context that slides in from a screen edge. Specify the Content side, Title/Description, and Close, and let Radix handle open state, focus, and Escape. Close the sheet after a selection in mobile navigation.

Avoid: using it as a centered modal, destructive confirmation, or permanent desktop sidebar. For a bottom gesture surface, compare it with Drawer.

## Public API

`Sheet`, `SheetTrigger`, `SheetContent`, `SheetTitle`, `SheetDescription`, `SheetClose`. Check `ui/src/components/Sheet/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Sheet><SheetTrigger asChild><IconButton aria-label="Navigation"><Menu aria-hidden="true" /></IconButton></SheetTrigger><SheetContent side="left"><SheetTitle>Navigation</SheetTitle><SheetDescription>Choose a destination.</SheetDescription><SidebarNav>{links}</SidebarNav></SheetContent></Sheet>
```

See `ui/src/components/Sheet/Sheet.stories.tsx` for states and compositions.
