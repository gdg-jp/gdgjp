# Dialog

## Use case

Use for a modal that temporarily focuses the user on a task. Always include Title and Description in Content. Let Radix handle open/defaultOpen/onOpenChange, Escape, Tab, outside interaction, and focus return. For a controlled display without a Trigger, specify the return target with `onCloseAutoFocus`.

Avoid: using it for an entire page, a lightweight hint, or a destructive confirmation. Do not casually nest Dialogs.

## Public API

`Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`. Check `ui/src/components/Dialog/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Dialog><DialogTrigger asChild><Button>Edit</Button></DialogTrigger><DialogContent><DialogTitle>Edit event</DialogTitle><DialogDescription>Enter the changes.</DialogDescription><FormField label="Name"><Input /></FormField></DialogContent></Dialog>
```

See `ui/src/components/Dialog/Dialog.stories.tsx` for states and compositions.
