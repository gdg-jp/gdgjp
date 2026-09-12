# AlertDialog

## Use case

Use for destructive or critical confirmations that require a cancellation decision. Always include Title, Description, Cancel, and Action, and make the result explicit in Action. Follow the Radix contract for open/defaultOpen/onOpenChange and focus restoration.

Avoid: using it for general editing forms, informational displays, or auto-dismissing notifications. Never create a destructive confirmation without Cancel.

## Public API

`AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel`, `AlertDialogAction`. Check `ui/src/components/AlertDialog/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<AlertDialog><AlertDialogTrigger asChild><Button variant="danger">Delete</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogTitle>Delete this item?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction>Delete</AlertDialogAction></AlertDialogContent></AlertDialog>
```

See `ui/src/components/AlertDialog/AlertDialog.stories.tsx` for states and compositions.
