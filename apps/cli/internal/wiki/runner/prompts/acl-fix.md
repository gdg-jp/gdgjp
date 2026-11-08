The ACL check rejected the pages you wrote. Fix only what the findings below describe. For each
finding, on that page, wrap the statements taken from the named source (`sourceId`) in
`<acl src="<sourceId>">…</acl>`, whatever that source's visibility (`member` included), or
remove them. If the page lists the source in its front matter `sources` but holds no statement
from it, remove the source from `sources`. Never change `visibility` or `access` to silence a
finding. Do not make other changes. Edit files only.
