# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/h0c0de/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/h0c0de/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot of 758 protocols, finds the 342 that record no token yet, and ranks 198 of them by an implied launch FDV — TVL times a blended multiple (each category's live-peer median market-cap/TVL, winsorized, then shrunk in log space toward a size curve fitted on all live protocols), adjusted for seven-day momentum and for time survived with no token. The model backtests itself leave-one-out on the snapshot's 128 live-token protocols (median fold error 3.56×), so every value is published as a range, not a point. The 144 protocols set aside — wrapped, staked, bridged, versioned and exchange products of tokens that already trade — are listed in the dashboard with the reason for each; curator and allocator rows are ranked but flagged borderline. The static dashboard shows the ranked board (sortable, filterable, with a detail view, live comparables and a farm plan with a cost verdict per protocol), the published set-aside list, the live-token protocols kept apart, and the full methodology with the backtest. Model `comparables-curve-3`; no protocol name is special-cased anywhere.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22 or later, standard library only, no network. `--input` takes the sealed snapshot file (or a directory holding it); the grader mounts it at `/input`. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`, and is deterministic: two runs over the same snapshot write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=53t06jr6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
