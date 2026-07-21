# 002 — Make desktop sidebar motion compositor-friendly

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: HIGH
- **Category**: Performance / accessibility
- **Estimated scope**: 2 files, about 45 lines

## Problem

`wiki/app/components/BaseSidebar.tsx:35` animates `width` on both the fixed sidebar and the main
content spacer:

```tsx
// wiki/app/components/BaseSidebar.tsx:35 — current
const isCollapsed = isMobile ? false : width < COLLAPSE_THRESHOLD;
const displayWidth = isOpen ? width : 0;
const transition = isResizing ? "none" : "width 200ms var(--motion-ease-out)";
```

```tsx
// wiki/app/components/BaseSidebar.tsx:111 — current
<aside
  style={{ width: displayWidth, transition }}
  className="fixed bottom-0 left-0 top-14 overflow-hidden border-r border-gray-200 bg-white"
>
```

```tsx
// wiki/app/components/BaseSidebar.tsx:127 — current
<div style={{ width: displayWidth, transition }} className="flex-shrink-0" />
```

Animating width forces layout and paint across navigation and page content every frame. The same
movement remains enabled for `prefers-reduced-motion: reduce`.

## Target

Keep the sidebar's physical width equal to `width`, reveal/hide it with compositor-backed
`translateX`, and make the content column use a discrete layout offset instead of an animated
spacer. The motion must be:

```css
transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
transform: translateX(0);       /* open */
transform: translateX(-100%);   /* closed */
```

Under reduced motion, use `transition-duration: 0ms`. Pointer resizing must remain immediate. Do
not animate `width`, `margin`, `padding`, `left`, or grid tracks.

The executor may replace the spacer with a wrapper/grid structure only if necessary to keep main
content correctly offset while open. The open/closed layout offset must switch discretely; the
sidebar itself supplies the visual transition.

## Repo conventions to follow

- Motion tokens live in `wiki/app/app.css:152`: enter is `200ms`, and strong ease-out is
  `cubic-bezier(0.23, 1, 0.32, 1)` via `--motion-ease-out`.
- `wiki/app/app.css:310` is the centralized reduced-motion layer.
- Predetermined movement must use `transform`, consistent with `.motion-presence` at
  `wiki/app/app.css:252`.

## Steps

1. In `BaseSidebar.tsx`, stop deriving or applying a `width` transition.
2. Keep `width` on the `<aside>` for user-controlled resizing, and add an open/closed transform
   state using `translateX(0)` and `translateX(-100%)`.
3. Apply `transform 200ms var(--motion-ease-out)` only when not resizing; resizing itself remains
   transition-free.
4. Remove the animated-width spacer. Adjust the immediate desktop layout offset so content does
   not sit underneath an open sidebar and no layout property interpolates.
5. Add a narrowly scoped class and reduced-motion rule in `wiki/app/app.css` so the transform snaps
   with `transition-duration: 0ms` under `prefers-reduced-motion: reduce`.

## Boundaries

- Do NOT change mobile Sheet behavior, stored widths, collapse thresholds, or drag calculations.
- Do NOT introduce a second animation library.
- Do NOT animate any layout property.
- If preserving the desktop layout would require a broader page-shell redesign, STOP and report.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck`, `pnpm lint`, and the narrow relevant
  Playwright navigation tests if present; all must pass.
- **Feel check**: at 10% DevTools animation playback, toggle the desktop sidebar and confirm only
  the sidebar slides; the main content must not squash frame-by-frame. Drag-resize the open sidebar
  and confirm it tracks the pointer without lag. Emulate reduced motion and confirm toggling is
  immediate. Test widths just above and below the 120px collapse threshold.
- **Done when**: DevTools shows no interpolated width/layout animation and sidebar toggles remain
  visually correct at desktop, mobile, and reduced-motion settings.

