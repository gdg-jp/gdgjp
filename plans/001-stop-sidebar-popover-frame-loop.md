# 001 — Stop polling sidebar popover position every frame

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file, about 25 lines

## Problem

`wiki/app/components/SidebarPopover.tsx:21` continuously reads layout and schedules a React
state update while a panel is open, even when the anchor and viewport have not moved:

```tsx
// wiki/app/components/SidebarPopover.tsx:21 — current
// Track anchor position with rAF while open
const updatePosition = useCallback(() => {
  const anchor = anchorRef.current;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - 400));
  const left = rect.right + 8;
  setPos({ top, left });
}, [anchorRef]);

useEffect(() => {
  if (!open) return;

  let rafId: number;
  function loop() {
    updatePosition();
    rafId = requestAnimationFrame(loop);
  }
  loop();

  return () => cancelAnimationFrame(rafId);
}, [open, updatePosition]);
```

This burns frame budget for as long as Recent, Starred, or Archived remains open and can compete
with scrolling and the panel's own transition.

## Target

Calculate the position once when the panel opens, then recalculate only on events that can move the
anchor: captured `scroll` and window `resize`. Schedule at most one calculation per browser frame:

```tsx
useEffect(() => {
  if (!open) return;

  let frame = 0;
  const schedulePositionUpdate = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(updatePosition);
  };

  schedulePositionUpdate();
  window.addEventListener("scroll", schedulePositionUpdate, true);
  window.addEventListener("resize", schedulePositionUpdate);

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedulePositionUpdate, true);
    window.removeEventListener("resize", schedulePositionUpdate);
  };
}, [open, updatePosition]);
```

Do not run a self-perpetuating rAF loop and do not update `pos` when no positioning event occurred.

## Repo conventions to follow

- `wiki/app/components/tasks/useAnchoredMenu.ts:87` already recalculates an anchored menu only on
  captured scroll events. Follow that event-driven lifecycle.
- Keep the existing `useCallback` position calculation and React state shape.
- Use `window.requestAnimationFrame` and `window.cancelAnimationFrame`, matching
  `wiki/app/components/ui/motion.tsx`.

## Steps

1. In `wiki/app/components/SidebarPopover.tsx`, retain `updatePosition` as the single position
   calculation function.
2. Replace the perpetual `loop()` effect with the open-time, captured-scroll, and resize effect
   shown in the target.
3. Ensure cleanup cancels the pending frame and removes both listeners with the same capture flag.

## Boundaries

- Do NOT change the popover markup, motion values, origin, or outside-click behavior.
- Do NOT change `useAnchoredMenu.ts`.
- Do NOT add dependencies.
- If the cited effect has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: from the repository root run `pnpm --filter @gdgjp/wiki typecheck` and expect no
  TypeScript errors; run `pnpm lint` and expect no Biome errors.
- **Feel check**: open Recent, Starred, and Archived; scroll the page and resize the window. Confirm
  each panel stays aligned without jitter. In DevTools Performance, leave a panel open for five
  seconds without interacting and confirm there is no continuous React render/layout activity.
- **Done when**: an open stationary popover causes no recurring rAF, layout read, or state update.

