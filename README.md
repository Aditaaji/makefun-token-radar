# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Aditaaji/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Aditaaji/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2) turns a sealed DefiLlama protocol snapshot into a ranked board of genuine pre-token launches. Every row is priced from the snapshot's own numbers — category-calibrated market multiples, no name ever special-cased — and carries a seven-step farm plan plus a filterable dashboard. The 40-protocol watchlist is the floor, never the ceiling: the board also ranks every other eligible pre-token protocol below the $50M floor, 197 rows on the current snapshot.

## How the model prices a row

The implied value comes only from the snapshot's figures, with the calibration computed from the snapshot itself at run time:

```
implied = round(tvl_usd x category_multiple
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.02 x min(chains - 1, 5)))
```

- **Category multiple**: the median market-cap-to-TVL of the live protocols in that category (at least 3 of them trading), else the median over every live protocol, clamped to [0.05, 1.0]. A lending protocol is not priced like a DEX.
- **Growth**: seven-day TVL change, clamped to [-60%, +120%], weighted 0.5.
- **Maturity**: age since first listing (unknown age: 365 days), from 0.6x to 1.0x over three years.
- **Chains**: each extra chain up to five adds 2% — wider distribution is worth a little more.

**Who gets ranked** mirrors the watchlist's own definition: pre-token only, leaving out the CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking and Restaked BTC categories, version-marked names, names carrying a whole word `wrapped` / `staked` / `staking` / `restaking` / `restaked`, and names beginning with an exchange name. A wrapped, staked or bridged product of a token that already trades is never ranked as a launch candidate — WBTC is Bitcoin on Ethereum, not a protocol still waiting on a launch.

**Farm plans** give each protocol seven steps, built from its category, chains, TVL and age: a fresh wallet, a category-specific main action with capital and gas, a second distinct qualifying action, a category-specific weekly action, a hold period, a category-specific rewards check, and a farm log. Every step states its cost and time.

**The dashboard** (`dashboard/`) is a static page with no network: a sortable, filterable board (search, category, chain), a Live token view that sets the already-trading protocols aside with their market caps, a per-protocol detail drawer that recomputes the row from the snapshot figures and checks it against `board.json`, plus the model formula and the full category-calibration table.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

It needs Node.js 22.18 or later and nothing beyond the standard library. The program reads the sealed snapshot (`/input/snapshot.json`, or `--input <file|dir>`), writes the ranked board to `board.json`, the dashboard dataset to `data.js`, copies `dashboard/` and `screenshots/` through, and writes `dossier.json` last with the vendored make.fun library. Run it twice on the same snapshot and both runs write identical bytes.

The three screenshots in `screenshots/` come from the dashboard in headless Chromium at 1440x900: the board, a protocol detail view, and a category-filtered board.

## What's where

- `main.ts` — entrypoint: reads the snapshot, scores the board, writes the output
- `lib/model.ts` — the radar-2 model: calibration, eligibility, implied value, farm plans
- `dashboard/` — `index.html`, `app.js`, `app.css`: the static dashboard
- `vendor/makefun-board.ts` — the vendored make.fun dossier builder
- `screenshots/` — the three dashboard screenshots the gate requires

---

<sub>Entered on [make.fun](https://make.fun/?ref=m1dr84q9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
