# 009 — Restrain the theme icon scale crossfade

- **Status**: DONE
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Physicality
- **Estimated scope**: 1 file, 2 class-string edits

## Problem

The Sun and Moon icons shrink to 25% during the theme crossfade:

```tsx
// wiki/app/components/Navbar.tsx:105 — current
<Sun
  size={18}
  aria-hidden="true"
  className={`absolute transition-[opacity,scale,filter] duration-200 ease-[var(--motion-ease-out)] motion-reduce:scale-100 motion-reduce:blur-0 motion-reduce:duration-100 ${isDark ? "scale-100 opacity-100 blur-0" : "scale-25 opacity-0 blur-[4px]"}`}
/>
<Moon
  size={18}
  aria-hidden="true"
  className={`transition-[opacity,scale,filter] duration-200 ease-[var(--motion-ease-out)] motion-reduce:scale-100 motion-reduce:blur-0 motion-reduce:duration-100 ${isDark ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"}`}
/>
```

At 25%, the outgoing icon appears to collapse into almost nothing. That is visually harsher than the
rest of the crisp, restrained product motion.

## Target

Use `scale-95` (`scale(0.95)`) for the hidden icon while retaining `opacity-0 blur-[4px]`. Keep the
visible icon at `scale-100 opacity-100 blur-0`, duration at 200ms, and strong ease-out at
`cubic-bezier(0.23, 1, 0.32, 1)`.

Reduced motion remains exactly 100ms, with `scale-100` and `blur-0`, so it becomes an opacity-only
crossfade.

## Repo conventions to follow

- Popovers and dialogs enter from 95% scale in `wiki/app/components/ui/popover.tsx:33` and
  `dialog.tsx:55`; use the same restrained physical range.
- Preserve the current explicit transition property list and reduced-motion utilities.

## Steps

1. Change the Sun icon's hidden `scale-25` class to `scale-95`.
2. Change the Moon icon's hidden `scale-25` class to `scale-95`.
3. Do not alter opacity, blur, timing, positioning, or theme logic.

## Boundaries

- Do NOT introduce icon rotation, morphing, spring motion, or new SVGs.
- Do NOT change the theme transition elsewhere in the page.
- Do NOT remove the existing reduced-motion behavior.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck` and `pnpm lint`.
- **Feel check**: toggle themes at normal speed and 10% playback. Confirm icons feel like a subtle
  crossfade rather than collapsing. Rapidly toggle and confirm neither icon flashes. Emulate reduced
  motion and confirm there is no scale or blur change.
- **Done when**: both hidden icons use exactly 95% scale and all other behavior is unchanged.
