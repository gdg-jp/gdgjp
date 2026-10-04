# agents-index architecture

`src/cli.ts` composes the store, embedder, watcher and daemon; `src/proxy.ts` is
its stdio client entrypoint. Keep those paths stable for agent-host deployment.

- `daemon/server.ts` owns Unix socket lifecycle and newline framing.
- `daemon/rpc.ts` dispatches MCP requests, resolves the caller against the
  service-configured authorization socket and serializes navigation results.
- `daemon/socket-access.ts` applies host socket permissions.
- `authz.ts` resolves nonces; `search.ts` scans ranked candidates, applies ACLs
  and projects only paths, line ranges and scores.
- `acl/` parses metadata and evaluates access with shared gdg-lib policies.
- `indexer/` owns chunking, embeddings, SQLite persistence and file watching.

Transport calls RPC dispatch; dispatch calls authorization and search; search
calls ACL evaluation and the index store. Indexing does not depend on transport.
Document text stays inside the indexer/store boundary and never enters RPC
results. Clients cannot supply an authorization endpoint or permission classes.

`test/daemon.test.ts` covers real socket startup across slots. `test/rpc.test.ts`
covers the RPC authorization and output boundary without a running daemon;
ACL and search tests cover filtering separately. Deployments vendor `src/**`, so
source moves require regenerating the CLI's embedded agent-host assets.
