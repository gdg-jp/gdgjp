# 011 — Unify MotionPresence timing defaults

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: LOW
- **Category**: Cohesion / tokens
- **Estimated scope**: 1 file, about 15 lines

## Problem

The shared product tokens are 200ms enter and 140ms exit:

```css
/* wiki/app/app.css:152 — current */
--motion-duration-micro: 140ms;
--motion-duration-enter: 200ms;
--motion-duration-exit: 140ms;
```

But `motionStyle`, `MotionPresence`, and `MotionSwap` each declare a parallel 180ms/120ms default:

```tsx
// wiki/app/components/ui/motion.tsx:28 — current
function motionStyle({
  axis = "y",
  distance = 4,
  enterDuration = 180,
  exitDuration = 120,
  reducedDuration = 100,
```

```tsx
// wiki/app/components/ui/motion.tsx:54 and :119 — current in both components
enterDuration = 180,
exitDuration = 120,
```

Most conditional UI therefore has a nearly—but not exactly—matching cadence.

## Target

Define one JS timing constant for the unmount timer and align all public defaults with the CSS
tokens:

```tsx
const MOTION_DURATION_ENTER_MS = 200;
const MOTION_DURATION_EXIT_MS = 140;
const MOTION_DURATION_REDUCED_MS = 100;
```

Use those constants as the defaults in `motionStyle`, `MotionPresence`, and `MotionSwap`. The emitted
CSS values must be exactly `200ms`, `140ms`, and `100ms`. Explicit caller overrides remain valid.

Do not try to read computed CSS variables during render. The named constants are required because
the exit-unmount timeout needs a numeric value; keep a comment pointing to
`wiki/app/app.css:152-154` as the canonical CSS token definitions.

## Repo conventions to follow

- `SidebarPopover.tsx:77-78` already explicitly uses the token cadence of 200/140ms.
- `.motion-presence` falls back to CSS tokens at `wiki/app/app.css:256,264`; the inline defaults must
  match those fallbacks.
- Keep `100ms` reduced feedback, matching `wiki/app/app.css:310-323`.

## Steps

1. Add the three named numeric constants near the motion types in `ui/motion.tsx`, with a comment
   identifying the matching CSS tokens.
2. Replace all three copies of numeric 180/120/100 defaults with the named constants.
3. Preserve the current option types, custom override API, timer cleanup, and rendered-state logic.
4. Search for callers with explicit 200/140 overrides; leave them unchanged unless removing an
   exactly redundant override is mechanically safe and local to this file's consumers.

## Boundaries

- Do NOT change motion distance, scale, opacity, presence sequencing, or component APIs.
- Do NOT read `getComputedStyle` or add context solely to share these constants.
- Do NOT alter explicit non-default timings chosen by callers.
- If CSS token values changed after commit `2257801`, update the constants to match the current CSS
  and report the drift.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck`, `pnpm lint`, and
  `rtk rg -n 'enterDuration = 180|exitDuration = 120' wiki/app`; the search should return no matches.
- **Feel check**: inspect Toast, sidebar inline feedback, ingestion status swaps, and Share dialog
  state swaps at 10% playback. Confirm a consistent 200ms entrance and 140ms exit, no blank frame
  between swaps, and clean interruption. Reduced motion must remain 100ms and position-free.
- **Done when**: shared presence defaults exactly match the declared product timing scale.

