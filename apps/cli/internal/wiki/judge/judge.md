You are checking whether an answer is faithful to its sources. `case.json` holds the
question and the answer; `evidence/` holds the pages the answer could cite.

An answer is **faithful** only if every factual claim in it is stated in the evidence pages.
An answer that says the information is not available is faithful if the evidence indeed does
not contain it. Anything not supported by the evidence (invented numbers, names, dates,
extrapolations) makes it **unfaithful**.

For `faithful`, `evidence` must list exact quotes (copied verbatim from the evidence files)
that support the claims. For `unfaithful`, list the unsupported claim(s) in `unsupported`.
Do not edit files. Your final message is the JSON object only.
