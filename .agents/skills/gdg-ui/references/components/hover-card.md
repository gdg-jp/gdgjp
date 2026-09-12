# HoverCard

## Use case

Supplement a link, person, or similar target with a richer preview on pointer hover and focus. Use Radix props for the open delay and placement, and preserve the Trigger's original action.

Avoid: using it for required information, an interaction form, content readable only on touch, or a simple short description. Use Tooltip for short text.

## Public API

`HoverCard`, `HoverCardTrigger`, `HoverCardContent`, `HoverCardArrow`. Check `ui/src/components/HoverCard/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<HoverCard><HoverCardTrigger asChild><Link href="/members/1">Yamada</Link></HoverCardTrigger><HoverCardContent>GDG Tokyo Organizer</HoverCardContent></HoverCard>
```

See `ui/src/components/HoverCard/HoverCard.stories.tsx` for states and compositions.
