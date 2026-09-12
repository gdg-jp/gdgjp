# GDG Apps UI design principles

Use this document to guide app implementation decisions. The source of truth is `ui/DESIGN.md`, and the source of truth for manually edited tokens is `ui/src/styles/tokens.css`. Recheck values and contracts in those sources during the work; do not duplicate a second token definition in an app.

## Visual language

- Use calm neutral surfaces by default, reserving GDG Blue for the most important action or selection on a screen. Restrict secondary to supporting actions and danger to destructive actions.
- Express surfaces with calm claymorphism. Use low-contrast outer lift and inner highlights; do not introduce decorative black or white borders, gradients, glass effects, or heavy blur. Keep borders for structural boundaries such as table rows, separators, and accordion internals.
- Treat finite corner radii, `--gdg-radius-*`, and squircles as one contract. Do not override the dedicated pill, circle, or square shapes.
- Use 4px-based spacing with 8/12/16/24/32/48px steps. Do not create hierarchy with nested Cards; organize with alignment, whitespace, type, `Stack`, `Inline`, and `Separator`.
- Prefer Google Sans, Noto Sans JP, and then system-ui. Choose heading levels from document structure. Wrap long Japanese text and user input so the page does not overflow horizontally.

## Responsive behavior and interaction

- Use a mobile-first approach with a maximum content width of 1280px. At narrow widths, use roughly 16px horizontal and 24px vertical padding, and scroll tables within their own region.
- Keep hit areas for coarse pointers at least 44px. Do not confuse the visual icon size with the interactive area.
- Use hover only as supplementary feedback for precise pointers, and ensure that state and actions remain understandable without hover.

## Theme, color, and accessibility

- Use `--gdg-*` or semantic utilities from `@gdgjp/ui/tailwind.css`, not literal theme colors. Check the relationship between surfaces, text, focus, and status in both Light and Dark themes.
- Maintain a minimum contrast ratio of 4.5:1 for normal text and 3:1 for important controls and focus indicators. Do not reuse brand colors for small body text or status text.
- Prefer native semantics, labels, headings, captions, and `aria-current`. Dialog/Sheet require a Title and Description, AlertDialog requires Cancel and Action, and icon-only actions require an accessible name.
- Show errors on the relevant field or in a persistent Alert. Do not make a Toast the only path for an error that requires resolution. Do not use Skeleton alone as a loading announcement.
- In forced-colors mode, do not rely on shadow-only boundaries; verify that focus and selection remain distinguishable.

## Motion

Use motion only for feedback, state comprehension, and preserving spatial relationships. The standard easing is `cubic-bezier(0.23, 1, 0.32, 1)`, with 120ms for presses, 180ms for popups, 250ms for dialogs, and 280ms for sheets. Do not use `transition: all`, `scale(0)`, `ease-in`, or decorative motion for theme, tab, or list refreshes. Make keyboard interactions immediate; with `prefers-reduced-motion`, stop movement, scaling, spinners, and shimmer, retaining only a short opacity transition when necessary.
