# Token Radar — Build the best token launch radar (token-radar-01)

A dashboard that ranks pre-token DeFi protocols by implied launch value, from a sealed
DefiLlama snapshot (2026-11-14). Free entry, no network at runtime, no paid APIs.

## What it does

- Reads `/input/snapshot.json` (758 protocols, 40 on the house watchlist).
- Ranks **178 pre-token protocols**: all 40 watchlist slugs plus 138 early-radar protocols
  below the $50M floor that pass the same wrapped/staked exclusion as the watchlist.
- **Model radar-2** (see `lib/model.ts`): implied value = TVL × base multiple × growth ×
  maturity × chain breadth. The base multiple is **calibrated from the snapshot itself** —
  the median market-cap/TVL ratio of the 119 live-token protocols (0.2460) — not a typed-in
  guess. Growth is 7-day TVL change clamped to −60…+120%; maturity rewards how long a
  protocol has run with no token (up to 3 years); breadth rewards multi-chain distribution
  (+4% per extra chain, capped at 10). No protocol name is special-cased.
- Every row carries a **7-step farm plan** with a cost and a time per step, derived from the
  protocol's category, chains, TVL and age.
- The dashboard (`dashboard/`) is a static page with no network: sortable board, search,
  category + chain filters, a watchlist-only toggle, a Live-token tab set aside with market
  caps, and a detail drawer per protocol that recomputes the row from the snapshot figures
  and shows the same number `board.json` carries.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/token-radar-01-kit/input/snapshot.json
```

Node 22.18+ (tested on Node v24.22.1). Writes `out/board.json`, `out/data.js`,
`out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Two runs are byte-identical.

## Measured (2026-11-14, this VM)

- 178 rows (40 watchlist + 138 early), ranks 1–178, implied values strictly decreasing,
  all distinct. Rank 1: Steakhouse Financial, $748,875,636. Rank 178: Monarq, $715,364.
- Farm steps: 7 per row, 124–220 characters each.
- Dashboard source 36,493 bytes (dossier text 36,757 bytes, cap 65,536 — all files shown whole).
- Dossier 712,036 bytes (cap 1.5 MiB); rebuild from `vendor/makefun-board.ts` is byte-identical.
- Local gate-shape check: all 7 rows pass (`/tmp/gate-check.mjs`, kept outside the repo).
- Page render verified under a DOM shim: 178 board rows, detail drawer opens, filtered view
  (Lending + watchlist) shows 3 rows, page recompute agrees with `board.json` 178/178.

## Status: NOT submitted — one step remains

⚠️ **Screenshots are placeholders.** `screenshots/` currently holds the kit starter's three
images so the pipeline can run end-to-end. They show the starter dashboard, NOT this one,
and must be replaced before submission with real 1440×900 captures of this dashboard:

1. Board — `out/dashboard/index.html`
2. Detail view — `out/dashboard/index.html#p=steakhouse-financial`
3. Filtered view — `out/dashboard/index.html#category=Lending&watchlist=1`

No browser binary on this VM can take them (the Chromium payload at
`/opt/meta-chromium/chrome` refuses headless startup with a domain-policy error), so they
must be taken via the live browser. After swapping them in, re-run `main.ts` and the
gate-shape check before submitting.

## Layout

- `main.ts` — entrypoint (Node 22, stdlib only)
- `lib/model.ts` — radar-2 model, board builder, farm plans, snapshot parser
- `vendor/makefun-board.ts` — kit library (byte-identical to the kit)
- `dashboard/` — `index.html`, `app.css`, `app.js` (no network, no framework)
- `screenshots/` — 3 PNGs (PLACEHOLDER images until re-taken, see above)
- `kit/` — the downloaded competition kit (manifest + RULES.txt + snapshot)
- `NOTES.md` — feasibility notes, decisions, measured results

## License

MIT — see `LICENSE`.
