# Codex review gate

Pull requests into `main` need the `codex-review` commit status to pass before they
merge. Only the `main` ruleset's bypass actors can merge without it. The status passes
after at least one Codex review has run on the pull request and every finding from every
Codex review on it has been confirmed resolved by the agent.

The agent runs Codex CLI on GitHub-hosted runners with the model in the repository
variable `CODEX_REVIEW_MODEL` (default `gpt-6.2-astra`) at the reasoning effort in
`CODEX_REVIEW_EFFORT` (default `medium`). It signs in with a ChatGPT account through the
[Codex login workflow](../../.github/workflows/codex-login.yml).

## Using it on a pull request

1. Add the `E-code-review` label. The agent reviews the diff against the merge base,
   posts one review with an inline comment per finding, and removes the label. Adding the
   label again requests another review; that is optional.
2. Fix each finding, then add any reaction to its comment or reply to it (for example
   "解決しました"). A reply can also explain why the finding is wrong.
3. The agent checks the current head of the pull request. When the problem is gone, or
   it agrees with your explanation after reading the code, it replies with ✅ and resolves
   the thread. Otherwise it replies with ❌ and what remains; respond again after the next
   fix.
4. To ask the agent to check every unresolved finding at once, comment `/codex` (or
   mention `@github-actions`) on the pull request.

Replies, labels, and `/codex` comments start the agent immediately. GitHub sends no
event for reactions, so a scheduled run picks them up within about ten minutes.

| Status | Meaning |
| --- | --- |
| pending, "Add the E-code-review label ..." | No Codex review has run yet. |
| pending, "queued or running" / "checking" | The agent has work for this pull request. |
| failure, "N of M Codex findings are unresolved" | Respond to the remaining findings. |
| success | At least one review ran and all of its findings are resolved. |
| error, "Codex is not signed in" | Run the Codex login workflow. |
| error, "Codex agent failed" | Read the linked run; comment `/codex` or re-add the label to retry. |

Fork pull requests do not get Codex reviews because their workflows cannot use the
login; a bypass actor merges them after a human review.

## Trust model

- Only the agent's own replies change a finding's state. The gate reads hidden
  `codex-review:*` markers in comments authored by `github-actions[bot]`, which people
  cannot post. Resolving a thread by hand does not resolve the finding.
- Reactions, replies, and `/codex` comments count only from people with write access
  to the repository. Other bots are ignored.
- Codex runs without the GitHub token under a permission profile that allows reading the
  filesystem, denies the Codex home that holds the login, and allows no writes. Before
  each run, `codex-review.mjs sandbox-check` confirms through `codex sandbox` that the
  sandbox can read the checkout but cannot read `auth.json` or write, and the job stops
  if it can. Pull request content therefore cannot make Codex push, comment, change labels,
  or read the login. The workflow posts only the JSON that Codex returns, after redacting
  every value from the login and neutralizing any `<!--` so it cannot carry gate markers.
- A verdict marker counts only as the last marker of the agent's reply in that
  finding's thread.
- Pull request authors with write access can change these workflows in their branch, as
  with any `pull_request` check. The ruleset's code-owner review on `.github/` covers that.

## Signing in

The login is a ChatGPT device-code sign-in stored as a workflow artifact encrypted with
the repository secret `CODEX_AUTH_KEY` (AES-256-GCM). The repository is public, so the
artifact is never stored in plain text. The run log, and therefore the one-time code, is
public too. Anyone who enters the code first could attach their own ChatGPT account, so
the login and every restore check that the account's email hashes to the repository secret
`CODEX_ACCOUNT_SHA256` (SHA-256 of the lowercase email) and refuse any other account.

1. Open Actions → **Codex login** → **Run workflow**.
2. Open the run. The **Show the login link** step prints the link and one-time code, and
   the run summary shows them as an annotation.
3. Open the link, sign in to the ChatGPT account the agent should use, and enter the
   code within 15 minutes. Device code sign-in must be enabled in that account's ChatGPT
   security settings.
4. The run finishes by storing the encrypted login as the `codex-auth` artifact.

Every agent run restores the newest `codex-auth` artifact and stores a new one when
Codex refreshed its tokens, keeping the three newest. All runs that touch the login share
the `codex-auth` concurrency group so a refresh token is never used twice. Artifacts
expire after 90 days, so an agent that has not run for 90 days needs a new sign-in.

To rotate the encryption key or change the account, set the secrets and run the login
workflow again:

```sh
openssl rand -base64 48 | gh secret set CODEX_AUTH_KEY
printf '%s' 'agent-account@example.com' | shasum -a 256 | cut -d' ' -f1 | gh secret set CODEX_ACCOUNT_SHA256
```

## Files

- [`codex-review.yml`](../../.github/workflows/codex-review.yml): the plan job sets the
  status on each event or every ten minutes for all open pull requests; the agent job
  runs Codex when there is work.
- [`codex-review.mjs`](../../.github/scripts/codex-review.mjs): gate evaluation, prompts,
  and GitHub writes.
- [`codex-auth.mjs`](../../.github/scripts/codex-auth.mjs): login encryption, restore,
  refresh storage, and redaction.
