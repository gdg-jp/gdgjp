# Wiki design tokens

`app/app.css` is the single source of truth for Wiki UI colours. Components and
routes must use semantic Tailwind utilities generated from those tokens (for
example, `bg-surface-raised`, `text-content-secondary`, and
`border-feedback-warning-border`), never palette-scale utilities such as
`bg-blue-500` or fixed colour literals.

## Token families

- `surface-*`, `content-*`, and `border-*` describe structural UI colours.
- `action-*` describes interactive controls, including their foreground and hover colours.
- `feedback-{info,success,warning,danger}-*` describes alert and status UI.
- `task-*` describes task-state badges.
- `presence-*` supplies deterministic collaboration-avatar and cursor colours.
- `brand-google-*` supplies the fixed Google brand colours used by the landing experience.

The semantic token, rather than its current colour value, must be selected by
the component. `app.css` supplies appropriate light and dark values.

## Exceptions

Persisted team/tag colours and user-selected identity colours remain dynamic
data: their database and API representation is a hex colour and is not themed.
When a UI TSX source must pass such a value through, put
`design-token-policy: allow-dynamic-color` on that exact line. This exception
does not permit a hard-coded UI colour.

Server-rendered email, OG-image renderers, and external SVG assets are outside
the application UI theme and are intentionally not scanned by the token-policy
test.
