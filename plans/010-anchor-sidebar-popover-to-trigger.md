# 010 — Anchor sidebar popover motion to its trigger

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Physicality / origin
- **Estimated scope**: 1 file, about 15 lines

## Problem

The panel's outer position follows the trigger's top edge, subject to viewport clamping:

```tsx
// wiki/app/components/SidebarPopover.tsx:25 — current
const rect = anchor.getBoundingClientRect();
const top = Math.max(8, Math.min(rect.top, window.innerHeight - 400));
const left = rect.right + 8;
setPos({ top, left });
```

But its scale origin is always the vertical center of the 400px panel:

```tsx
// wiki/app/components/SidebarPopover.tsx:71 — current
<MotionPresence
  present={open}
  axis="x"
  distance={-4}
  scale={0.98}
  transformOrigin="left center"
  enterDuration={200}
  exitDuration={140}
```

When the trigger is near the top or bottom, the panel scales from a point far from the control that
opened it.

## Target

Extend `pos` with a trigger-relative origin and calculate it whenever position is calculated:

```tsx
type PopoverPosition = { top: number; left: number; originY: number };

const originY = Math.max(0, Math.min(400, rect.top + rect.height / 2 - top));
setPos({ top, left, originY });
```

Apply:

```tsx
transformOrigin={`left ${pos.originY}px`}
```

The x-origin must remain at the panel's left edge because the trigger is immediately to its left.
The y-origin must follow the trigger center and remain clamped to the expected 400px panel bounds.

## Repo conventions to follow

- Trigger-anchored Radix primitives use computed transform origins in
  `wiki/app/components/ui/popover.tsx:33` and `dropdown-menu.tsx:36`.
- Keep the existing 0.98 scale unchanged because this plan is scoped only to correcting the origin;
  do not broaden it into a separate scale-tuning change.
- If plan 001 is complete, add this calculation inside its event-driven `updatePosition` function.

## Steps

1. Add a named `PopoverPosition` type containing `top`, `left`, and `originY`.
2. Calculate `originY` from the anchor center relative to the clamped panel top.
3. Replace `left center` with the computed pixel origin.
4. Test triggers near both viewport edges so clamping does not detach the origin.

## Boundaries

- Do NOT change panel dimensions, placement, motion distance, scale, or timings.
- Do NOT undo plan 001's event-driven positioning if it has been applied.
- Do NOT add DOM measurement of the panel itself unless the fixed 400px assumption has changed; if
  it has, STOP and report the drift.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck` and `pnpm lint`.
- **Feel check**: position Recent, Starred, and Archived triggers near the top, middle, and bottom of
  the viewport. At 10% playback, confirm scaling radiates from the trigger center, including when
  the panel's top position is clamped. Reduced motion should remain transform-free.
- **Done when**: the transform origin tracks the actual trigger center at every viewport position.
