# make-fun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sayaaku12/make-fun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sayaaku12/make-fun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks 178 pre-token protocols by implied launch value, built from a sealed snapshot of 758 protocols. Every row carries an implied value plus a concrete 7-step farm plan with cost and time, and the whole 40-protocol watchlist is covered, 40/40 — top of the board is Steakhouse Financial at $748,875,636 implied value.

The radar-2 model calibrates its base value multiple from the snapshot's own live-token median (0.2459877056611089) instead of a hardcoded guess, then weighs 7-day growth, maturity and chain breadth. Wrapped and staked products are excluded by the brief's own definition, so the board holds only rankable protocols. The dashboard is a static, offline page with search, category and chain filters, a watchlist-only toggle, sortable columns and a detail drawer per protocol.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/token-radar-01-kit/input/snapshot.json
```

The run writes `out/board.json` (178 rows, ranks 1–178 exactly once), `out/data.js`, and `out/dossier.json`, and copies the dashboard and screenshots into `out/`. It is deterministic: two runs produce byte-identical outputs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c0tz9ttj&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
