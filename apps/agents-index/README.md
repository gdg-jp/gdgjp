# agents-index

`agents-index` is a local, ACL-filtered semantic navigation service for a shared GDG wiki
worktree. It indexes Markdown from `pages/`, `raw/`, and `memories/`, then exposes an MCP
`search` tool that helps an agent find candidate files to read.

It is a navigation aid, not a content API: search results never include document text. Read a
returned path through the wiki read gate (`wk read`) before using its contents.

## API

The daemon is a newline-delimited JSON-RPC 2.0 MCP server over a Unix-domain socket. It supports
the standard `initialize` and `tools/list` requests, plus one tool:

```text
search
```

### `search`

Input:

```json
{
  "query": "string",
  "limit": 10,
  "pathPrefix": "pages/"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `query` | Yes | Natural-language search query. |
| `limit` | No | Maximum result count, from 1 to 50. Defaults to 10. |
| `pathPrefix` | No | Return only paths that start with this prefix. |

The tool returns an MCP tool result whose `content[0].text` is JSON and whose
`structuredContent.results` has the same value:

```json
{
  "results": [
    {
      "path": "pages/events/page.md",
      "startLine": 42,
      "endLine": 68,
      "score": 0.83
    }
  ]
}
```

`score` is a similarity-derived ranking score; use it to order candidates, not as a relevance
guarantee. Result objects contain only `path`, `startLine`, `endLine`, and `score`—never a
snippet or source text.

## Running the daemon

On the agent host the daemon is deployed and managed entirely by `gdg agent-host apply` (there is
no standalone installer). It writes a self-contained copy of `src/**` to `/opt/agents-index` — the
`@gdgjp/gdg-lib/acl/agent` import is rewritten to a vendored esbuild bundle so no workspace
resolution is needed — runs `npm ci` there, and manages `agents-index.service` as a **system**
unit (`/etc/systemd/system/`) running as `gdgagent-svc` with `SupplementaryGroups=` for the slot
socket groups. Its `--slots`, `--run-root`, and `--db` are derived from
`agent-host/agent-host.json` (`slotCount`, `paths.runRoot`, `agentsIndex.dbPath`); nothing is
configured twice. Set `agentsIndex.enabled` to `false` to turn it off: the next
`gdg agent-host apply` stops and disables `agents-index.service`, removes the unit and
`/opt/agents-index`, and leaves the persistent `/var/lib/agents-index` data in place.

For local development, run the long-lived indexer directly against a wiki worktree:

```sh
pnpm --filter @gdgjp/agents-index exec agents-index watch \
  --root /path/to/wiki-worktree \
  --authz-socket /run/gdg-agent/0/authz.sock
```

Options:

| Option | Description |
| --- | --- |
| `--root <workdir>` | Required wiki worktree to watch and index. |
| `--authz-socket <path>` | Required Unix socket for nonce-to-principal resolution. |
| `--db <path>` | SQLite database path. Defaults to `/var/lib/agents-index/index.db`. |
| `--socket <path>` | MCP daemon socket. Defaults to `AGENTS_INDEX_SOCKET` or `/run/gdg-agent/index.sock`. |

On startup the watcher indexes existing supported files and continues to incrementally update a
file when it changes. It also reloads raw-document metadata when `.gdgwiki/state.json` changes
and ACL-source metadata when `.gdgwiki/acl-sources.json` changes.

The embedder uses `intfloat/multilingual-e5-small` locally (384 dimensions); query and document
text are not sent to an embedding API.

## Connecting an MCP client

MCP clients should start the supplied stdio proxy, not the daemon directly. The proxy forwards
newline-delimited JSON-RPC between standard input/output and the configured daemon socket, adding
the caller's authorization nonce to each request.

```sh
AGENTS_INDEX_SOCKET=/run/gdg-agent/0/index.sock \
XANGI_AUTHZ_NONCE="${XANGI_AUTHZ_NONCE}" \
pnpm --filter @gdgjp/agents-index exec node src/proxy.ts
```

`gdg agent-host apply` writes the static per-slot MCP configuration and the proxy shim
(`/opt/gdg-agent/lib/index-proxy.ts`) that each agent slot launches. The production daemon runs
under the service identity, which can read the index database; the proxy runs as the agent
identity and must not be granted database access.

For a manual protocol check, send one JSON object per line to the proxy:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"event budget","limit":5}}}
```

## Authorization and safety model

Every `tools/call` is authorized by resolving the request nonce with the daemon's configured
`--authz-socket`. A client cannot select the authorization endpoint, and callers cannot pass
permission classes or channel audience in tool arguments.

The service fails closed: if the nonce is absent or cannot be resolved to both permission classes
and a channel audience, `search` returns an empty result list. Before returning a match, it applies
the shared channel-aware ACL evaluators to the page or source and to every ACL source span that
intersects the indexed chunk.

Keep the default database outside the worktree and inaccessible to agent users. The database
contains indexed text for reindexing efficiency; only the daemon may read it. Exposing the
database or adding snippets/content to `search` would bypass the wiki read gate.

Search examines candidates in similarity order, filters unauthorized entries, then applies the
requested limit. It stops after the first of these bounds and returns any authorized partial
results collected so far:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `INDEX_MAX_SCANNED` | `1000` | Maximum vector candidates scanned. |
| `INDEX_SEARCH_TIMEOUT_MS` | `2000` | Search time budget in milliseconds. |

## Development

Run the workspace checks from the repository root:

```sh
pnpm --filter @gdgjp/agents-index test
pnpm --filter @gdgjp/agents-index typecheck
```

Use `search` to locate a likely file, then read it through the approved wiki access path. An empty
result means no accessible match was found within the search bounds; it does not prove that the
wiki contains no relevant information.
