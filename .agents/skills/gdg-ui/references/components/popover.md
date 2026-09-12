# Popover

## Use case

Use for a small supporting action/content surface anchored to a trigger. Use open/defaultOpen/onOpenChange, side/align/collision, and focus according to the Radix contract, and add Close when needed.

Avoid: using it for long forms, required information, destructive confirmations, or page navigation. Use Tooltip for short descriptions.

## Public API

`Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverClose`. Check `ui/src/components/Popover/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Popover><PopoverTrigger asChild><Button variant="outline">Details</Button></PopoverTrigger><PopoverContent><Text>Additional information</Text><PopoverClose>Close</PopoverClose></PopoverContent></Popover>
```

See `ui/src/components/Popover/Popover.stories.tsx` for states and compositions.
