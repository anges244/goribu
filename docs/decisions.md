# Goribu decisions

This log records Goribu's settled design forks. A row is added when the decision
is actually embodied in this tree; decisions carried over from the previous
version are ported here as their code lands, not before. Append a row whenever
implementation resolves a new fork.

| Date | Block | Decision | Chosen | Why (1 line) | Alternatives |
|---|---:|---|---|---|---|
| 2026-08-23 | 1 | Node floor | Node `>=22` | Keeps framework tooling on the current modern API baseline. | Node `>=20` |
| 2026-08-23 | 1 | Export map | Four entries: `.`, `./server`, `./client`, `./vite` | Explicit runtime and build boundaries help prevent code leaks. | Fold `./vite` into `./server` |
| 2026-08-31 | 1 | Application config channel | One branded `defineConfig()` from `goribu/server` starting with the deploy fields `name`, `compatibilityDate`, `compatibilityFlags`; runtime fields (`Document`, `responseHeaders`, `database`) are added to this same validator as later blocks land their consumers | The config feeds Wrangler synthesis first; the previous version's config was coupled to parked/absent code (Postgres, response headers, database, Document) so it is grown field-by-field rather than copied wholesale | Copy the previous config wholesale, or split deploy and runtime config into separate files |
