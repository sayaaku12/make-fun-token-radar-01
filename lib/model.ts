// Token Radar's model, radar-2: a sealed snapshot goes in, a ranked board comes out.
//
// Coverage first: every slug on the snapshot's watchlist is on the board (the watchlist is a
// floor, never a ceiling), plus the early radar — pre-token protocols below the floor that pass
// the same wrapped/staked exclusion the house used to build the watchlist. A protocol counts as
// pre-token when its record carries no token at all (no market cap, no CoinGecko id, no symbol);
// protocols whose token already trades are kept apart and shown with the market's own figures,
// never mixed into the ranked board.
//
// The implied value is derived from the snapshot's own numbers only:
//
//   baseMultiple = median(mcap_usd / tvl_usd) over the snapshot's live-token protocols
//                  (calibrated from the snapshot itself, never typed in by hand)
//   base         = tvl_usd x baseMultiple
//   growth       = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity     = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   breadth      = 1 + 0.04 x min(distinct chains - 1, 10)  (more chains, wider reach)
//   implied      = max(1, round(base x growthMult x maturity x breadth))
//
// No protocol name is ever special-cased: one function scores every row on the board.

/** One protocol entry from the sealed snapshot: exactly its ten fields. */
export interface ProtocolRecord {
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

/** The whole snapshot document, as the sealed input file carries it. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** The model's tunable numbers. The dashboard prints them, and a run may override them; every
 *  scored number comes from these, never from a hidden constant. */
export interface ModelParams {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

/** Fallback multiple, used only when the snapshot carries no live-token protocol to calibrate from. */
export const DEFAULT_BASE_MULTIPLE = 0.25;

export const DEFAULT_MODEL: ModelParams = {
  base_multiple: DEFAULT_BASE_MULTIPLE, // replaced by the snapshot calibration at run time
  growth_weight: 0.5, // weight of the weekly growth term
  growth_floor: -60, // weekly change is clamped at -60%
  growth_cap: 120, // ... and at +120%
  maturity_floor: 0.6, // a brand-new listing still scores 60% of its base
  maturity_range: 0.4, // ... rising to 1.0 over three years
  maturity_days: 1095, // three years, in days
  unknown_age_days: 365, // assumed age when the listing date is missing
  breadth_per_chain: 0.04, // +4% per extra chain
  breadth_max_chains: 10, // breadth stops counting after ten extra chains
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_LABEL = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROW_LIMIT = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStepDraft {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardEntry {
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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface CompactRow {
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
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_calibration_n: number;
  rows: CompactRow[];
  live: LiveEntry[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

// One day, in milliseconds: the unit ageInDays divides by.
const MS_PER_DAY = 86_400_000;

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimal places: the multipliers the board prints. */
const roundTo4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const firstSeen = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(firstSeen)) return null;
  return Math.max(0, Math.floor((start - firstSeen) / MS_PER_DAY));
}

/**
 * The base multiple, calibrated from the snapshot itself: the median market-cap-to-TVL ratio
 * across the live-token protocols it carries. A token launch is priced the way the market already
 * prices the tokens that trade, not by a number typed in by hand.
 */
export function calibrateBaseMultiple(snapshot: SnapshotDoc): { multiple: number; n: number } {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.gecko_id === null) continue;
    if (p.category === 'CEX') continue;
    if (p.tvl_usd > 0 && p.mcap_usd > 0) ratios.push(p.mcap_usd / p.tvl_usd);
  }
  ratios.sort((a, b) => a - b);
  if (ratios.length === 0) return { multiple: DEFAULT_BASE_MULTIPLE, n: 0 };
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return { multiple: median, n: ratios.length };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function scoreProtocol(
  protocol: ProtocolRecord,
  asOf: string,
  model: ModelParams,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageInDays(asOf, protocol.listed_at);
  const rawChange = finiteOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawChange));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const distinctChains = new Set(protocol.chains).size;
  const extraChains = Math.min(Math.max(distinctChains - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house's watchlist rule treats as a wrapped, staked or bridged product. */
const EXCLUDED_KINDS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word `wrapped`, `staked` or `staking` in a name marks a product of a token that trades. */
const WRAPPED_STAKED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names: a protocol beginning with one is the exchange's own product, not a launch of its own. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function recordsNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a protocol whose token already trades — the same exclusion the house used for the
 * watchlist, applied here to the early radar below the floor as well.
 */
export function mayRank(p: ProtocolRecord): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_KINDS.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_STAKED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function indexBySlug(protocols: ProtocolRecord[]): Map<string, ProtocolRecord> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardCounts {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: SnapshotDoc, model: ModelParams = DEFAULT_MODEL): BoardEntry[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, ProtocolRecord>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the same wrapped/staked
  // exclusion, by TVL, every one of them — not a capped sample. Never a replacement for a watchlist
  // row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && mayRank(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = scoreProtocol(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, breadthMult, age };
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
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: roundTo4dp(s.growthMult),
      maturity_multiplier: roundTo4dp(s.maturityMult),
      breadth_multiplier: roundTo4dp(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: planFarmSteps(s.p, s.age).map(renderStep),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function renderStep(step: FarmStepDraft): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: ProtocolRecord): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalForTvl(p: ProtocolRecord): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysForAge(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function mainActionFor(p: ProtocolRecord, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote on its next proposal.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action, so the farm stays active instead of going quiet. */
function weeklyAction(p: ProtocolRecord): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'repay a small borrow, top up collateral, or adjust the supplied amount';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'swap a small amount through the pool or rebalance the range';
  if (c.includes('bridge')) return 'bridge a small amount back and use it in the app';
  if (c.includes('staking') || c.includes('restak')) return 'claim or compound the staking rewards';
  if (c.includes('perpetual') || c.includes('derivative')) return 'close the hedge and open a fresh small one';
  if (c.includes('prediction')) return 'settle one market position and open the next';
  if (c.includes('curator') || c.includes('allocator')) return 'move a small amount between two of the vaults';
  if (c.includes('governance')) return 'vote on the newest proposal';
  return 'make one deposit, swap or vote';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Nothing here is a promise: the protocol records no token, so a launch may never come, and
 * the position itself has to be worth holding.
 */
export function planFarmSteps(p: ProtocolRecord, age: number | null): FarmStepDraft[] {
  const chain = firstChain(p);
  const capital = capitalForTvl(p);
  const hold = holdDaysForAge(age);
  const action = mainActionFor(p, capital, chain);
  const weekly = weeklyAction(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Once a week, do one qualifying action on ${chain} — ${weekly} — so the activity never goes quiet.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates, the amounts and every transaction in a farm log, and compare the protocol's TVL each week.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
    {
      text: `Never deposit more than you can afford to lose: this protocol records no token, so a launch may never come.`,
      cost: 'nothing to remember, everything to lose if ignored',
      time: '1 minute',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveTokenRows(snapshot: SnapshotDoc): LiveEntry[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROW_LIMIT)
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function compactRow(row: BoardEntry, onWatchlist: boolean): CompactRow {
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    on_watchlist: onWatchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadarOutput(
  snapshot: SnapshotDoc,
  model: ModelParams = DEFAULT_MODEL,
): { board: BoardEntry[]; radar: RadarPayload } {
  const calibration = calibrateBaseMultiple(snapshot);
  const tuned: ModelParams = { ...model, base_multiple: calibration.multiple };
  const board = buildBoard(snapshot, tuned);
  const live = liveTokenRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: tuned,
    model_version: MODEL_LABEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_calibration_n: calibration.n,
    rows: board.map((r) => compactRow(r, watchlist.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function readSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotShapeError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotShapeError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotShapeError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotShapeError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotShapeError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotShapeError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotShapeError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotShapeError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? [...new Set(p.chains.filter((c): c is string => typeof c === 'string'))] : [],
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function validateBoard(board: BoardEntry[], snapshot: SnapshotDoc): string | null {
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
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. Angle brackets, ampersands and line separators are escaped after stringify, so a snapshot string can never close the script element if the page ever inlines this file. */
export function radarScript(radar: RadarPayload): string {
  const json = JSON.stringify(radar)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `window.RADAR=${json};\n`;
}
