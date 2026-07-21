# 006 — Remove layout animation from the Share dialog

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file, about 20 lines

## Problem

The notification-message field animates grid tracks and margin for 300ms:

```tsx
// wiki/app/components/ShareDialog.tsx:621 — current
<div
  aria-hidden={!notify}
  inert={notify ? undefined : true}
  className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-[var(--motion-ease-out)] motion-reduce:duration-100 ${notify ? "mt-5 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}
>
  <div
    className={`min-h-0 overflow-hidden transition-[visibility] duration-0 ${notify ? "visible delay-0" : "invisible delay-300 motion-reduce:delay-100"}`}
  >
```

`grid-template-rows` and `margin` force reflow throughout an already complex dialog, and 300ms is at
the UI-duration ceiling.

## Target

Use the existing `MotionPresence` component to mount through exit and animate only opacity and
transform. Exact behavior:

```tsx
<MotionPresence present={notify} distance={-4} className="mt-5">
  {/* existing field content */}
</MotionPresence>
```

The shared target is 180ms enter, 120ms exit at this commit, with strong
`cubic-bezier(0.23, 1, 0.32, 1)`. If plan 011 has already executed, inherit its token-backed
200ms/140ms defaults instead. Under reduced motion, `MotionPresence` must retain its existing 100ms
opacity feedback and remove movement. The field must be inert and disabled while absent/exiting.

## Repo conventions to follow

- `ShareDialog.tsx:642` already uses `<MotionPresence present={Boolean(error)} ...>` in the same
  dialog. Follow that markup pattern.
- `wiki/app/components/ui/motion.tsx:94-112` supplies `aria-hidden`, `inert`, exit retention, and
  transform/opacity motion.

## Steps

1. Replace the grid-track wrapper and visibility-delay wrapper with `MotionPresence`.
2. Keep the current textarea markup unchanged inside it.
3. Preserve `disabled={!notify}` so the field cannot be edited during exit.
4. Ensure spacing is applied to the presence wrapper without animating margin.

## Boundaries

- Do NOT change form logic, notification behavior, textarea rows, validation, or dialog screens.
- Do NOT animate height, grid tracks, margin, padding, top, or left.
- Do NOT add dependencies.
- If the fixed `mt-5` causes a closed-state gap after MotionPresence unmounts, correct only wrapper
  placement; do not introduce another layout animation.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck` and `pnpm lint`.
- **Feel check**: toggle “notify” repeatedly at 10% playback. Confirm the field reverses cleanly,
  never clips text, and becomes unfocusable while hidden. Record a DevTools Performance trace and
  confirm the transition animates only opacity/transform. Under reduced motion, confirm a brief fade
  with no position change.
- **Done when**: the field has a retained exit and no layout property interpolates.

