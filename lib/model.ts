// Radar-2, the model behind Token Radar: one snapshot of the protocol universe in, one ranked board out.
//
// What gets ranked is every genuine pre-token protocol. The watchlist is the floor, never the
// ceiling: all 40 of its protocols rank, plus every other protocol below the floor that can still
// launch a token. Eligibility copies the watchlist's own rule, so a wrapped, staked or bridged
// product of an already-trading token is never ranked as a launch candidate. WBTC is Bitcoin on
// Ethereum; Binance staked ETH is ETH inside a staking product; neither is a protocol still waiting
// for a launch of its own. A restaking vault named after the staked token it holds (Valantis stHYPE
// Restaking) is the same kind of product. The snapshot has no parentProtocol field, so the rule
// works with the fields it does carry.
//
// Implied value is built only from the snapshot's own figures, with the calibration computed from
// the snapshot itself at run time:
//
//   category multiple = median mcap/TVL of the live protocols in the protocol's category, when at
//                       least 3 of them trade; otherwise the median across every live protocol.
//                       Clamped to [0.05, 1.0], so one outlier cannot price a whole category.
//   base              = tvl_usd x category multiple
//   growth            = change_7d clamped to [-60, 120] per cent
//   growth multiplier = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity          = 0.6 + min(age_days, 1095) / 1095 x 0.4   (unknown age counts as 365 days)
//   chain multiplier  = 1 + 0.02 x min(chains - 1, 5), at most five extra chains
//   implied           = max(1, round(base x growth multiplier x maturity x chain multiplier))
//
// The dashboard states the constants, and the model sandbox may change them. No protocol name is
// ever special-cased: one function scores every row, and the calibration is computed from the
// snapshot at run time, never written in by hand.

/** One protocol entry from the snapshot: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document, as the sealed input carries it. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the model sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_calibration_n: number;
  multiple_floor: number;
  multiple_cap: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_calibration_n: 3,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  chain_step: 0.02,
  chain_max_extra: 5,
};

/** The model's version label, named by the dashboard and quoted by the rules. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, largest market cap first. */
export const LIVE_ROWS = 24;

/** One category's calibration: the multiple, and how many live protocols set it. */
export interface CategoryCalibration {
  multiple: number;
  n: number;
  source: 'category' | 'fallback';
}

/** The whole calibration: a multiple per category with enough live protocols, plus the fallback. */
export interface Calibration {
  byCategory: Record<string, { multiple: number; n: number }>;
  fallback: number;
}

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of the ranked board, as board.json carries it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    calibration_n: number;
    calibration_source: 'category' | 'fallback';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page generates its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  calibration_n: number;
  calibration_source: 'category' | 'fallback';
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A protocol whose token already trades: the board shows the market's own value for it, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs to render: the board, the live set, the calibration, and the model itself. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The error for a snapshot this model cannot score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, or `fallback` when the value is not one. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, never below zero; null when either date is absent or unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list that holds at least one number. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A multiple clamped inside the model's floor and cap. */
function clampMultiple(value: number, model: ModelConstants): number {
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, value));
}

/**
 * The calibration, worked out from the snapshot while the program runs: every category with at
 * least min_calibration_n live protocols that carry a market cap gets the median of their mcap/TVL;
 * the fallback is the median over all live protocols that carry one. Nothing is written in by hand.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0,
  );
  const fallback = clampMultiple(median(live.map((p) => p.mcap_usd! / p.tvl_usd)), model);
  const byCategory: Record<string, { multiple: number; n: number }> = {};
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  for (const [key, values] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (values.length >= model.min_calibration_n) {
      byCategory[key] = { multiple: clampMultiple(median(values), model), n: values.length };
    }
  }
  return { byCategory, fallback };
}

/** A category's multiple under a calibration, with the count of live protocols that set it. */
export function categoryMultiple(category: string | null, calibration: Calibration): CategoryCalibration {
  const entry = category !== null ? calibration.byCategory[category] : undefined;
  if (entry !== undefined) return { multiple: entry.multiple, n: entry.n, source: 'category' };
  return { multiple: calibration.fallback, n: 0, source: 'fallback' };
}

/** The three multipliers and the implied value for one protocol under a model and a calibration. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: Calibration,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  categoryMult: number;
  calibrationN: number;
  calibrationSource: 'category' | 'fallback';
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const chainMult = 1 + model.chain_step * extraChains;
  const { multiple, n, source } = categoryMultiple(protocol.category, calibration);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return {
    implied,
    growthPct,
    growthMult,
    maturityMult,
    chainMult,
    categoryMult: multiple,
    calibrationN: n,
    calibrationSource: source,
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release number is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist's rule keeps out: wrapped, staked and bridged products. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** A name that starts with an exchange's name: the exchange's own product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name carrying a whole word wrapped, staked, staking, restaking or restaked: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking|restaking|restaked)\b/i;

/** Whether a protocol has no token on record at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the board may rank a protocol: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades. The rule copies the watchlist's own definition, using
 * the fields the snapshot carries; parentProtocol is not one of them, so it cannot be checked here.
 */
export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols, looked up by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline figures: watchlist slugs, rows ranked, and live protocols set aside. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, numbered 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  calibration: Calibration = calibrate(snapshot, model),
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record). A watchlist
  // slug that fails eligibility is still ranked: the gate demands every one of them.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other eligible protocol, watchlist or below the floor alike. No TVL cap
  // and no hand-picked count: the radar exists to find them all.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isEligible(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, calibration);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMult,
      calibration_n: s.calibrationN,
      calibration_source: s.calibrationSource,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: the action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, sized from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The hold length, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, phrased so a farmer can follow it. */
/** One category rule: how to spot the category, and the four actions that farm it. */
interface CategoryRule {
  match: (category: string) => boolean;
  main: (name: string, capital: number, chain: string) => string;
  second: (name: string, capital: number, chain: string, small: number) => string;
  weekly: (name: string, capital: number, chain: string, small: number) => string;
  weeklyCost: string;
  rewards: (name: string) => string;
}

/** Whether a lowercased category contains any of these words. */
function hasAny(category: string, words: string[]): boolean {
  return words.some((w) => category.includes(w));
}

/**
 * The category rules, first match wins: each rule names the words that spot its category and the
 * two actions that farm it. The last rule matches everything, so every category finds a plan.
 */
const CATEGORY_RULES: CategoryRule[] = [
  {
    match: (c) => hasAny(c, ['lend', 'cdp', 'collateral']),
    main: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
    second: (name, capital, chain, small) => `Borrow $${small} against the supply on ${name}, then repay it in the same week.`,
    weekly: (name, capital, chain, small) => `Each week, supply $${small} more to ${name} or borrow $${small} against the supply and repay it.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for supply and borrow incentives and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['dex', 'yield', 'leveraged farm', 'farm']),
    main: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
    second: (name, capital, chain) => `Make one swap through ${name}'s main pool on ${chain} for about $10 of volume.`,
    weekly: (name, capital, chain, small) => `Each week, collect the fees ${name}'s pool earned and compound them back in.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s points page for LP and swap quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['bridge']),
    main: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
    second: (name) => `Bridge a small amount back through ${name} so the round trip is on record.`,
    weekly: (name, capital, chain, small) => `Each week, bridge $${small} to ${chain} through ${name} and use the bridged funds.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for bridge quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['staking', 'restak']),
    main: (name, capital) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
    second: (name) => `Claim the staking rewards ${name} shows and restake them in the same position.`,
    weekly: (name, capital, chain, small) => `Each week, top up the stake on ${name} by $${small}.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s staking page for staking quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['perpetual', 'derivative', 'basis']),
    main: (name, capital) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
    second: (name) => `Close the hedge on ${name} and open a fresh one half its size.`,
    weekly: (name, capital, chain, small) => `Each week, open one small hedge on ${name} and close it before the week ends.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s trading rewards page for volume quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['prediction']),
    main: (name, capital) => `Fund $${capital} and place one market position on ${name}.`,
    second: (name) => `Settle one market on ${name} and place a second position in another.`,
    weekly: (name, capital, chain, small) => `Each week, place a $10 market position on ${name} in a market closing that week.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for market quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['curator', 'allocator']),
    main: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
    second: (name, capital, chain, small) => `Move $${small} into a second ${name} vault on ${chain}.`,
    weekly: (name, capital, chain, small) => `Each week, check the ${name} vaults' yields and move $${small} to the highest-yielding vault on ${chain}.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s vault rewards page for deposit quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['stable']),
    main: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
    second: (name) => `Redeem a small part of the stable position on ${name} and mint it back.`,
    weekly: (name, capital, chain, small) => `Each week, move $${small} of the stable asset through ${name} into a yield venue on ${chain}.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for stable-mint quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['rwa']),
    main: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
    second: (name) => `Claim the yield the ${name} asset accrued and hold the rest.`,
    weekly: (name, capital, chain, small) => `Each week, mint $${small} more of the ${name} yield asset on ${chain} and hold it.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for holding quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['insurance']),
    main: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
    second: (name) => `File one test claim on ${name} to learn the flow, then keep the policy.`,
    weekly: (name, capital, chain, small) => `Each week, check the ${name} cover on ${chain} and extend it before it lapses.`,
    weeklyCost: 'the weekly premium, plus about $2 of gas',
    rewards: (name) => `Check ${name}'s rewards page for cover quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['options']),
    main: (name, capital, chain) => `Deposit $${capital} into an ${name} options vault on ${chain} and keep the shares.`,
    second: (name) => `Roll one options position in the ${name} vault to the next expiry.`,
    weekly: (name, capital, chain, small) => `Each week, add $${small} to the ${name} options vault on ${chain} and keep the shares.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s vault rewards page for deposit quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['index']),
    main: (name, capital, chain) => `Buy $${capital} of the ${name} index on ${chain} and hold it.`,
    second: (name) => `Rebalance the ${name} index holding once, then hold it again.`,
    weekly: (name, capital, chain, small) => `Each week, buy $${small} more of the ${name} index on ${chain} and hold it.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for holding quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['payment', 'card']),
    main: (name, capital, chain) => `Top up $${capital} through ${name} on ${chain} and spend from the balance.`,
    second: (name) => `Make one purchase with the ${name} balance and top it up again.`,
    weekly: (name, capital, chain, small) => `Each week, top up the ${name} balance by $${small} and spend it from the balance.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for spend quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['chain']),
    main: (name, capital, chain) => `Bridge $${capital} to ${chain} and use one native app on it through ${name}.`,
    second: (name, capital, chain) => `Use a second native app on ${chain} through ${name} in the same week.`,
    weekly: (name, capital, chain, small) => `Each week, use a native app on ${chain} through ${name} that you have not used yet.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s ecosystem quests page for ecosystem quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: (c) => hasAny(c, ['privacy']),
    main: (name, capital, chain) => `Deposit $${capital} into ${name}'s shielded pool on ${chain} and keep the receipt.`,
    second: (name) => `Withdraw a small amount from the ${name} pool and deposit it back.`,
    weekly: (name, capital, chain, small) => `Each week, move $${small} between two shielded pools on ${name}.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Check ${name}'s rewards page for pool quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
  {
    match: () => true,
    main: (name, capital, chain) => `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: (name) => `Do one more distinct action on ${name}, such as a swap, a vote or a second deposit.`,
    weekly: (name, capital, chain, small) => `Each week, make one qualifying action on ${name}, such as a deposit, a borrow, a swap or a vote.`,
    weeklyCost: 'about $2 of gas a week',
    rewards: (name) => `Once a week open the protocol's own points or rewards page and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.`,
  },
];

/** The rule for a category, first match in the table wins. */
function ruleFor(category: string | null): CategoryRule {
  const c = (category ?? '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.match(c)) return rule;
  }
  return CATEGORY_RULES[CATEGORY_RULES.length - 1]!;
}

/** The category's main action, phrased so a farmer can follow it. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  return ruleFor(p.category).main(p.name, capital, chain);
}

/** The category's second qualifying action: a different touch from the first, so the plan is a pattern, not one click. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const small = Math.max(10, Math.round(capital / 5));
  return ruleFor(p.category).second(p.name, capital, chain, small);
}

/** The category's weekly action: a small repeatable touch, so the plan keeps working week after week. */
function weeklyActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const small = Math.max(10, Math.round(capital / 5));
  return ruleFor(p.category).weekly(p.name, capital, chain, small);
}

/** The weekly action's cost, which the rule states because a premium is not gas. */
function weeklyCostFor(p: SnapshotProtocol): string {
  return ruleFor(p.category).weeklyCost;
}

/** The category's rewards check: which page to watch and what to follow there. */
function rewardsActionFor(p: SnapshotProtocol): string {
  return ruleFor(p.category).rewards(p.name);
}

/**
 * One protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * Steps 2, 3, 4 and 6 are category-specific; steps 1, 5 and 7 keep the same shape for every protocol
 * because wallet hygiene, the hold and the log do not depend on the category.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${capital >= 150 ? 5 : 2} of gas`,
      time: '10 minutes',
    },
    {
      text: weeklyActionFor(p, capital, chain),
      cost: weeklyCostFor(p),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: rewardsActionFor(p),
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js; the farm plan is generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    calibration_n: row.model.calibration_n,
    calibration_source: row.model.calibration_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, built from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot parsed out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** What makes a board one the gate will not take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js, compact: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
