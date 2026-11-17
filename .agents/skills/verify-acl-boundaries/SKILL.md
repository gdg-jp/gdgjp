---
name: verify-acl-boundaries
description: Check GDG shared ACL channel isolation by exhaustively executing the real TypeScript over bounded chapter, role, source, and page inputs. Use after changing packages/gdg-lib/src/acl/core.ts or its ACL types and channel policy.
---

# Verify ACL boundaries

Protect confidential chapter information from appearing in a wider channel answer.
Run the real production evaluators over a finite input space. This is bounded exhaustive
verification, not an unbounded proof, an SMT proof, or an end-to-end authorization audit.

## Run

Run from the repository root with Node 22.18 or newer. The verified tool version is
Node 26.3.1. No package install, server, credentials, or external service is required.

```sh
node --version
node .agents/skills/verify-acl-boundaries/scripts/verify.mjs
```

Node loads `core.ts` directly using built-in TypeScript stripping. The source imports
only types, so the verifier does not need the application bundle or an alias resolver.
The helper is executable, but use `node` to select the runtime explicitly.

The output names the evidence JSON under `local_data/pstack/acl-boundaries/`.
Evidence survives cleanup and is ignored by Git. Each invocation writes a new file.
A successful baseline checks 7,290 source inputs and 338,985 page inputs.

## Properties and independent oracle

For every allowed source or page result, check both conditions:

- The asking permission classes can read the content.
- Every person in the channel's audience can read the content.

The second condition matters when the asker belongs to more chapters than the channel.
The verifier constructs the people in each audience from chapter membership and role.
It never uses a production ACL helper to compute the expected permission.

Two positive witnesses also require a Tokyo chapter member to read a Tokyo chapter source
and a restricted page shared with Tokyo in a Tokyo member channel. These catch a verifier
that passes because the production evaluators deny every request.

## Bounds and exclusions

The complete Cartesian products include:

- Three chapter IDs, `tokyo`, `osaka`, and `outside`.
- All 27 membership vectors, with each chapter absent, member, or organizer.
- Nine channel keys, including private, national member, national organizer, and both
  chapter-specific channel kinds for every chapter.
- Five source visibilities and an unknown value.
- Five page visibilities and four unsupported values.
- Content chapter IDs that are null, empty, or one of the three chapter IDs.
- Every ordered page-grant array of length zero through two, including duplicates,
  chapter grants, an email grant, and an unknown grant type.

Email grants do not establish a class-based permission. Private source keys establish
no audience. The private channel has no generic membership audience. These choices match
the class-only API's scope and do not assert anything about a private individual's identity.

This check does not cover arbitrary strings or grant arrays longer than two, malformed
runtime objects outside these values, membership retrieval, token verification, database
queries, HTTP handlers, ACL markup, rendering, mutation authorization, or deployments.
A pass establishes the properties for the enumerated inputs only. Expand the domain before
claiming coverage of a new role, visibility, membership representation, or grant shape.

## Prove the checker can fail

```sh
node .agents/skills/verify-acl-boundaries/scripts/verify.mjs --mutation-proof
```

This runs the baseline, copies the actual `core.ts` text into temporary TypeScript modules,
and changes one real production expression per module. It removes each source and page
caller check and channel check, then forces each evaluator to deny all requests.
All six mutants must fail the corresponding property. The helper removes its temporary
modules, confirms that the production source text is unchanged, and reruns the baseline.

A source-channel counterexample means the following in application terms:

1. An asker belongs to Tokyo.
2. A source is restricted to Tokyo members.
3. The answer is allowed in a national member channel.
4. An Osaka member can see the channel but cannot read the source.

The JSON counterexample records the actual first failing input, which can differ from
this explanation. Report those fields without reducing the property to make a run pass.

## Coverage and source synchronization

[coverage.json](coverage.json) records the reviewed source SHA-256 values and synchronization
commit `d4f18a5694052c01b69d0a9267698e97ce2d145f`.

`packages/gdg-lib/src/acl/core.ts` owns the two channel-aware evaluators and their helpers
`canClassesAccessSource`, `canClassesSeePage`, `audienceKeyContains`,
`pageAudienceIncludesChannel`, and `sourceAudienceKey`.
`packages/gdg-lib/src/acl/types.ts` owns the permission-class, page, source, and channel shapes.
The channel and agent export modules expose the same implementation to consumers.

Exit code 0 means the bounded check passes with a current source record. Exit code 1 means
a property, mutation proof, or script operation failed. Exit code 2 means the bounded check
passed but the recorded source hashes need review.

After a covered source changes, read the diff and decide whether the audience oracle and
input bounds still describe the intended policy. Use `--allow-source-drift` to run the same
check during that review. This flag does not update the record. Update the hashes and move
`syncedCommit` forward only after confirming that the verification describes that commit.
Use `/maintain-formal-verification-skill` when an earlier change did not perform this review.

If a property fails, inspect the counterexample against the intended policy. A real leak
stays a finding. A modeling error requires evidence before changing the oracle. Do not
change product code as part of a verification-only request.
