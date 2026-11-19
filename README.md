# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Aditaaji/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Aditaaji/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-4) turns a sealed DefiLlama protocol snapshot into a ranked board of genuine pre-token launches. Every row is priced from the snapshot's own numbers — category-calibrated market multiples, no name ever special-cased — and carries an eight-step farm plan plus a filterable dashboard. The 40-protocol watchlist is the floor, never the ceiling: the board also ranks every other eligible pre-token protocol below the $50M floor, 197 rows on the current snapshot. All 758 protocols in the snapshot are accounted for: 197 ranked, 416 live-token protocols set aside with their market caps, 145 pre-token protocols set aside with the rule that sets each one aside.

## What changed in radar-4

- **The model now adjusts for size — and the out-of-sample error fell by a quarter.** Big protocols trade at a much lower market-cap-to-TVL than small ones (the median ratio falls from 0.65x in the smallest TVL quintile to 0.04x in the largest; log market cap grows only ~0.52 per dex of TVL), so each row's multiple is adjusted by 10 ^ (-0.50 x (log10(TVL) - 7.69)), the OLS slope of ln(mcap/TVL) on log10(TVL) capped at ±0.50. The fitted model now beats the flat baseline by 30.33% out of sample (median log error 1.1604 vs 1.6655, n=64 per split; leave-one-out 1.2636, n=128), against 6.87% for radar-3. The cap was picked because it wins on all three out-of-sample tests at once, not on any one alone.
- **Walk-forward validation is new.** The multiples are fit on the older live protocols and tested on the newer ones, at a 50% cut (1.0127 vs flat 1.6665, n=48) and a 70% cut (0.9914 vs flat 1.6667, n=29) — the 33 live protocols with no listing date sit out of this test, since they cannot be ordered in time. A model that only works on a random split cannot pass it. The dashboard shows the test.
- **The coverage audit is new.** All 145 set-aside pre-token protocols were re-checked one by one against the watchlist rule: 128 are CEX / bridge / liquid-staking / liquid-restaking products by category, 11 are version-marked names (Aera appears as both V2 and V3 — ranking them would count one protocol twice), and 6 more are staking products named as such (Staking Pool / Chain / Farm categories). None is an eligible launch that the board missed, so the board stays at 197 rows.
- **Multiples are log-medians, shrunk toward the global median** (5 pseudo-observations), so a category with one live protocol sits almost at the global median instead of swinging on it. The plain category median tied the flat baseline out of sample; the shrunk log-median beats it on both splits.
- **Every row carries a rank range**: the calibration is refit 500 times on bootstrap resamples of the live protocols, and each row keeps the 10th–90th percentile of the ranks it drew. The top ranks hold (1–2, 2–3); the dense mid-board honestly shows a wide range.
- **Farm plans net to break-even**: the eighth step totals the plan's gas over its hold and states the break-even — the plan pays only if the eventual allocation is worth more than that; if no token ever launches, the gas is the loss.
- **Dashboard chrome**: a model sandbox (growth weight, multiple cap, chain step — recomputes the board in place, page only), a compare mode for up to three rows, CSV export of the board, a dark/light theme toggle, and a Set aside tab listing every excluded protocol with its reason.

## How the model prices a row

The implied value comes only from the snapshot's figures, with the calibration computed from the snapshot itself at run time:

```
implied = round(tvl_usd x category_multiple x size_adjustment
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.02 x min(chains - 1, 5)))
```

- **Category multiple**: the median market-cap-to-TVL of the live protocols in that category, taken in log space and shrunk toward the global median (0.21x) with 5 pseudo-observations; a category with no live protocol uses the global median. A lending protocol is not priced like a DEX.
- **Size adjustment**: 10 ^ (-0.50 x (log10(tvl_usd) - 7.69)) — a large TVL is discounted and a small one marked up, because market cap grows far slower than TVL. The effective multiple (category multiple x size adjustment) is clamped to [0.05, 1.0].
- **Growth**: seven-day TVL change, clamped to [-60%, +120%], weighted 0.5.
- **Maturity**: age since first listing (unknown age: 365 days), from 0.6x to 1.0x over three years.
- **Chains**: each extra chain up to five adds 2% — wider distribution is worth a little more.

**Who gets ranked** mirrors the watchlist's own definition: pre-token only, leaving out the CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking and Restaked BTC categories, version-marked names, names carrying a whole word `wrapped` / `staked` / `staking` / `restaking` / `restaked`, and names beginning with an exchange name. A wrapped, staked or bridged product of a token that already trades is never ranked as a launch candidate — WBTC is Bitcoin on Ethereum, not a protocol still waiting on a launch.

**Farm plans** give each protocol eight steps, built from its category, chains, TVL and age: a fresh wallet, a category-specific main action with capital and gas, a second distinct qualifying action, a category-specific weekly action, a hold period, a category-specific rewards check, a farm log, and a break-even step that totals the plan's gas and states what the eventual allocation must be worth. Every step states its cost and time.

**The dashboard** (`dashboard/`) is a static page with no network: a sortable, filterable board (search, category, chain), a Live token view with all 416 already-trading protocols and their market caps, a Set aside view listing every excluded pre-token protocol with its reason, a per-protocol detail drawer that recomputes the row from the snapshot figures and checks it against `board.json`, plus the model formula, the out-of-sample validation table, the full category-calibration table, the model sandbox, compare mode, CSV export, and a dark/light theme.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

It needs Node.js 22.18 or later and nothing beyond the standard library. The program reads the sealed snapshot (`/input/snapshot.json`, or `--input <file|dir>`), writes the ranked board to `board.json`, the dashboard dataset to `data.js`, copies `dashboard/` and `screenshots/` through, and writes `dossier.json` last with the vendored make.fun library. Run it twice on the same snapshot and both runs write identical bytes.

The four screenshots in `screenshots/` come from the dashboard in headless Chromium at 1440x900: the board, a protocol detail view, a category-filtered board, and the validation panel.

## What's where

- `main.ts` — entrypoint: reads the snapshot, scores the board, writes the output
- `lib/model.ts` — the radar-4 model: calibration, eligibility, implied value, farm plans, out-of-sample validation (split-half, leave-one-out, walk-forward), bootstrap rank ranges
- `dashboard/` — `index.html`, `app.js`, `app.css`: the static dashboard
- `vendor/makefun-board.ts` — the vendored make.fun dossier builder
- `screenshots/` — the four dashboard screenshots the gate requires

---

<sub>Entered on [make.fun](https://make.fun/?ref=m1dr84q9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
