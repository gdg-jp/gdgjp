# Source correspondence

Implementation proceeds in committed phases with mandatory E2E. The ownership and
isolated-verification phase has passed all 17 configured suites without retries,
with 179 passed and one explicitly skipped real-SFU case. See
[validation](validation.md) for evidence and failed earlier attempts. The remaining
concepts below retain their actual implementation status until their phases run.

Reviewed on November 17, 2026 through Orca Browser. The video review used the English
automatic transcript and chapters, not a complete audiovisual review. X search was
`from:poteto comments`; long posts identified below were expanded. No claim is made
that every historical post or reply was read.

## Video

The source is [All Code Is Slop (Except Mine)](https://www.youtube.com/watch?v=O_zcc6Xl12g).

| Passage | Idea | Repository response | Remaining work |
| --- | --- | --- | --- |
| 1:03 to 2:03 | Increase throughput while preserving quality through investment in the environment | Engineering changes prioritize reliable checks before more automation | Whole-repository quality is not established by this change |
| 2:03 to 3:22 | Prioritize architecture, types, and deterministic checks; use prose for judgment | Reuse actual verifiers, remove duplicate CI task lists, and enforce workspace import ownership | Application-specific API/type review remains open |
| 3:27 to 4:51 | Agents copy workarounds and established patterns | Remove obsolete discovery links; change simplicity guidance; migrate Wiki OAuth callers and delete its forwarding API | Other application workarounds remain unaudited |
| 5:00 to 6:07 | Restrict APIs that require nuance; product code used replacement framework APIs instead of useEffect | Evaluate the API boundary rather than adding a blanket React ban | Unused Wiki editor APIs/effects removed; sharing lifetime keyed by page with real delayed-response E2E. A blanket React effect ban is not adopted |
| 6:10 to 6:49 | Make runtime ownership obvious in directories and enforce dependency direction | Add a first-party workspace import analyzer alongside existing architecture tests | Feature-to-route and runtime UI-to-server direct imports now enforced. Computed and transitive imports remain outside this gate |
| 6:56 to 9:35 | Comments can justify hacks; eliminate causes and replace prose with enforceable checks | Default no-new-comments gate; remove Wiki's comment-justified OAuth compatibility layer and guard export ownership | Semantic audit covered this OAuth layer; other legacy comments remain unaudited |
| 9:40 to 10:45 | Review runtime evidence; provide user-facing feature maps and reusable verification CLIs | Retain Wiki maps and isolated server helper; document their limits | Wiki editing/search/admin and other apps need mapped, executed journeys |
| 10:50 to 11:25 | Use TLA+ models or Lean proofs for costly state/algorithm bugs | Preserve the existing independent bounded ACL check and mutation proof | No new TLA+ or Lean model; bounded ACL enumeration is not an unbounded proof |
| 11:35 to 11:44 | UI property-based testing can find interaction bugs; Bombadil is one example | Record as a distinct open evaluation | No property-based UI driver or invariant suite implemented |
| 11:51 to 13:16 | Spend substantial effort on verification and review artifacts, including statecharts | Run real checks and publish failures as well as successes | No token quota, token instrumentation, or new statechart; the reported 70% is an observation, not a universal target |
| 13:32 to 15:01 | Assess throughput together with reverts and user performance | Do not adopt the speaker's PR counts as repository targets | No local release/revert/performance monitoring added |
| 15:11 to 17:04 | Build foundations before automating loops; verify full builds as a user | Repair delivery checks before adding autonomous release loops | No automated release fuzzing or automatic merging enabled |

## X posts

| Source | Reviewed content | Repository response |
| --- | --- | --- |
| [October 29](https://x.com/poteto/status/2115644484226777581) | Comments were banned because agents justify hacks with them | Default comment policy adopted with necessary exceptions |
| [October 16](https://x.com/poteto/status/2110758788525621282) | Expanded post recommends auditing comments and replacing them with stronger types, APIs, and lint | Gate rejects new comments; the first semantic repair removes Wiki OAuth forwarding and checks actual export ownership. Other legacy comments remain open |
| [October 14 clarification](https://x.com/poteto/status/2110229505864552902) | Keep comments that explain real browser quirks | External constraints remain eligible for reviewed exceptions |
| [October 17](https://x.com/poteto/status/2111133080526495985) | Expanded post orders improvements, checks, prose, and human review; recommends studying prior corrections and prototyping questions | Preserve this order; source/code comparison performed. Historical transcripts, Slack, and review-feedback mining were not performed |
| [November 15](https://x.com/poteto/status/2121646643124809848) | Expanded post warns that minimal patches spread as copied patterns | Root-cause guidance updated in both mode and leaf skill |
| [November 16](https://x.com/poteto/status/2122067662373269960) | Timeline embeds a truncated older statement about engineering responsibility | Do not treat it as a fully read older post |
| [November 14](https://x.com/poteto/status/2121417335055831368) | Return with a tangible result instead of an avoidable question | Implement reversible changes and show evidence |

The first pass did not explicitly track the UI property-testing example, verification
effort allocation, effect/API restrictions, release metrics, or the older correction-history
workflow. They are now explicit above. Documenting them does not mean implementing them.

## Documentation follow-up

An Orca X search for `from:poteto (docs OR documentation OR markdown)` found
[the October 13 writing post](https://x.com/poteto/status/2109885001584292091), read
expanded, and [its clarification](https://x.com/poteto/status/2109899035788345380).
The author prefers writing material that helps her think, while allowing agents
to help with recording and routine organization. This is her writing preference;
it does not prohibit the document organization requested by this repository's user.

The reviewed posts do not prescribe a folder taxonomy. The repository's separation
of guides, references, plans, and historical records is a local decision based on
the actual documents and consumers. It is not presented as a layout specified by poteto.
