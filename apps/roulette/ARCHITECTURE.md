# Roulette architecture

- `app/routes/` adapts React Router loader/action arguments and owns the composed screens:
  `projects/home.tsx` (list + create), `projects/admin.tsx` (settings, open/close, reset, the
  latest spins), `projects/draws-csv.ts` (every spin as CSV, same gate) and `draw/draw.tsx` (the
  public spin page). Auth plumbing routes are copied from ost.
- `features/auth/` owns relying-party sessions, sign-in redirects and chapter membership.
- `features/projects/` owns the D1 project registry, slug rules, creation and chapter-owner
  authorization (`access.server.ts`), and the admin status card.
- `features/prizes/` owns the prize model and pure rules: `odds.ts` (current odds per mode,
  ranks/tiers, the wheel layout from the configured mix) and `draft.ts` (the settings form,
  validated identically on the client and in the action). Its widgets are the mode picker and
  the prize table.
- `features/draw/` owns spinning: `draw.server.ts` (the atomic spin and the draw log query), the
  anonymous device cookie, the visitor-facing `DrawResult`, `log.ts` (the admin log and its CSV,
  never the device id), and the wheel, spin button, result card, effects and log card.
  `use-spin.ts` drives the animation; `feedback.ts` holds sound and vibration.
- `app/layouts/AdminLayout.tsx` is the signed-in shell.
- `app/lib/use-hydrated.ts` keeps controls that need JavaScript (spin, create, save, open,
  reset) disabled until hydration, so an early tap on a slow phone is not silently dropped.

## Draw modes

Standard counts what is left (unlimited prizes stand for `expected − draws − finite left`),
custom uses a % per prize, and evil is standard with some prizes `excluded`: shown to visitors and
on the wheel, never drawn. The mode is derived, not stored: `project.method` is `'fixed'`
(custom) or `'box'`, and a `'box'` project with an excluded prize is evil. Saving in another mode
clears the flags.

## Spinning

One spin is one D1 batch (a transaction): count the spin only while the project is open, take one
of the picked prize only if the spin counted and stock is left, then insert the draw with that
number. The insert's number is NULL — a NOT NULL violation that rolls everything back — unless
the prize was taken, and the unique `(project_slug, device_id)` index rolls back a second spin
from the same device. A rolled-back spin is re-read and retried, so concurrent spins never hand
out more than the stock. `prize`'s `won <= stock` CHECK guards settings saves the same way.

The spin page never receives stock, wins, odds or exclusions: only prize names/ranks, the wheel
layout (derived from the configured mix, not from what is left or excluded) and the device's own
result. The page
starts spinning on release, then eases into a slice of the server's prize at the same speed, so
the server round trip is hidden in the free spin. It opts out of revalidating after its own
action so the reveal is not cut short.

Features do not import routes; widgets do not import server modules.
