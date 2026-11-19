# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/h0c0de/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/h0c0de/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token yet, and ranks them by an implied launch value — TVL times a category peer multiple calibrated from the snapshot's own live-token protocols (winsorized, then shrunk toward the global median), adjusted for seven-day momentum and for time survived with no token. Wrapped, staked and bridged products of tokens that already trade are set aside, never ranked. The static dashboard shows the ranked board (sortable, filterable, with a detail view and a concrete farm plan per protocol), the live-token protocols kept apart, and the full methodology with the calibrated multiples. Model `peer-multiple-2.1`; no protocol name is special-cased anywhere.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22 or later, standard library only, no network. `--input` takes the sealed snapshot file (or a directory holding it); the grader mounts it at `/input`. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`, and is deterministic: two runs over the same snapshot write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=53t06jr6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
