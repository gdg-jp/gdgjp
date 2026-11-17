# Code comment policy

Do not add code comments by default. Remove narration and explanations that justify
a workaround. Prefer code that expresses the constraint through names, types, API
ownership, module boundaries, or a failing executable check.

Deleting an explanation does not repair the behavior it describes. Trace the cause
before removing code, changing retries, or deleting a dependency constraint. Keep
the existing behavior covered while replacing an obsolete path.

## Necessary exceptions

Retain legal notices, public API contracts, and explanations of behavior forced by
an external protocol, browser, platform, or dependency. A comment saying that our
own code is difficult or temporary is not an external constraint.

Review a necessary new comment against the actual implementation and source of
the external constraint. Record an exact exception in
`scripts/code-comment-exceptions.json` with these fields:

- `path` identifies the first-party source file.
- `sha256` identifies the complete comment text, including its delimiters.
- `category` is `legal`, `external-contract`, or `public-api`.
- `reason` explains why code cannot replace the explanation.
- `evidence` points to the contract or source establishing that need.

The checker prints the SHA-256 when it rejects a comment. Do not add a broad inline
suppression or an exception merely to make the check pass. Changes to the exception
registry require the same review as changes to the code. The checker verifies exact
matches and record structure; a reviewer must judge the reason and evidence.

Compiler and tool directives that use comment syntax also need an exact exception
when introduced. A real executable shebang is not treated as a comment.

## Automatic checks

Run these from the repository root:

```sh
pnpm check:comments
node scripts/check-code-comments.mjs --staged
node scripts/check-code-comments.mjs --diff BASE_SHA HEAD_SHA
node scripts/check-code-comments.mjs --files scripts/example.mjs
```

The default compares HEAD with tracked and untracked working files. The staged
command inspects the index, not unstaged edits. The diff command compares two
commit trees. The files command audits all comments in the supplied files.

The gate covers first-party JavaScript, TypeScript, JSX, TSX, and Go. It excludes
the three separate submodule repositories and generated/dependency/build artifacts.
Strings, template text, regular expressions, and JSX text are not code comments.
The Go scanner understands quoted strings, runes, raw strings, and comment delimiters;
it does not replace `go vet`, compilation, or Go syntax checking.

For a diff, unchanged legacy comment text in the same file remains allowed. Added
copies and edited comments require review. Moving a comment to a new file counts
as adding it. This gradual enforcement does not certify old comments as useful.
Other source languages follow the policy through review; this checker does not
claim to parse CSS, SQL, shell, HTML, or YAML comments.

`pnpm lint` and local quick/full CI include the working-file check. Staged CI uses
the index. Hosted CI runs **Code comments** for every change using the detected
base and head, including Go edits that do not select Biome.

Use [No comments](../../.agents/skills/no-comments/SKILL.md) for a semantic audit
of an affected area. The lexical gate prevents new unreviewed comments; it cannot
find or fix the architecture problem behind an old explanation.
