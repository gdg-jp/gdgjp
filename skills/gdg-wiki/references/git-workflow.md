# Git editing workflow

## Create or configure a working tree

```sh
gdg wiki clone [--lang ja|en] DIRECTORY
gdg wiki init DIRECTORY
```

`clone` defaults to Japanese and requires an empty destination. It installs/uses the
`git-remote-gdg-wiki` helper and configures `origin` as
`gdg-wiki::https://wiki.gdgs.jp/api/cli/wiki`. Use `--remote` only for an intentionally selected
alternate transport endpoint. `init` configures an existing directory.

## Edit and synchronize

```sh
cd DIRECTORY
git pull
# Read AGENTS.md, then edit the appropriate pages/** and attachments.
git status
gdg wiki verify-acl
git add <exact files>
git commit -m "docs: describe the change"
git push
```

`git pull` fetches web and Google Docs imports for Git to merge locally. `git push` synchronizes
committed page and attachment changes to the Wiki service. Resolve local merge conflicts as normal
Git conflicts while preserving the clone's content rules.

`gdg wiki lint` prints a review prompt for a coding agent; it does not itself modify files.
`gdg wiki verify-acl` checks changed pages. ACL findings fail closed, while infrastructure failures
emit a warning and fail open; do not mistake an infrastructure warning for completed validation.
