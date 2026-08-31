# Goribu decisions

This log records Goribu's settled design forks. A row is added when the decision
is actually embodied in this tree; decisions carried over from the previous
version are ported here as their code lands, not before. Append a row whenever
implementation resolves a new fork.

| Date | Block | Decision | Chosen | Why (1 line) | Alternatives |
|---|---:|---|---|---|---|
| 2026-08-23 | 1 | Node floor | Node `>=22` | Keeps framework tooling on the current modern API baseline. | Node `>=20` |
| 2026-08-23 | 1 | Export map | Four entries: `.`, `./server`, `./client`, `./vite` | Explicit runtime and build boundaries help prevent code leaks. | Fold `./vite` into `./server` |
