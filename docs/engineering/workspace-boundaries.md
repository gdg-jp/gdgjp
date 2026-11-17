# Workspace import boundaries

Applications own their implementations. Shared packages expose reusable contracts
through their package entry points. Use service bindings or HTTP contracts to call
another application's runtime.

Run `pnpm check:boundaries` from the repository root. The checker enforces these
cross-workspace rules for first-party JavaScript and TypeScript:

- An application cannot import another application's implementation.
- A shared package cannot import application code.
- An import of a shared workspace must name a declared dependency and a public
  package export. Relative paths and TypeScript aliases cannot bypass that entry.

The checker reads TypeScript syntax and workspace manifests. It checks literal
imports, reexports, dynamic imports, `require` calls, and import types. It checks
relative paths and TypeScript aliases even when their target file does not exist.
It does not compile applications or establish that a public export's build output
already exists.

The separate Git submodules own their internal rules. Their manifests supply
workspace contracts, but this repository's checker does not scan their sources.
PR's Playbook imports and Wiki's raw bootstrap document are content dependencies
outside workspace ownership.

`pnpm lint`, local quick/full CI, relevant staged CI, and the hosted repository
policy job run the check. Application architecture tests remain responsible for
feature layering, client/server separation, and local runtime cycles. This check
does not replace those tests or cover computed imports and `import.meta.glob`.
Literal `require` calls are interpreted as module loads; the checker does not
resolve whether a local function shadows that name.
