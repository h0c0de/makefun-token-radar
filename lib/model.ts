// Token Launch Radar — valuation model (model id "comparables-curve-3").
//
// One sealed DefiLlama snapshot in, one ranked board out. Every number on the board is a pure
// function of the snapshot's own figures: no protocol name is ever special-cased, no wall clock
// is read (ages are measured against the snapshot's own as_of date), and no randomness is used,
// so two runs over the same snapshot write byte-identical output.
//
// The model, in one paragraph. A protocol that records no token is priced off the protocols in
// the same snapshot whose tokens already trade (the fit set: 128 of them carry both a market cap
// and a TVL). Two facts about that fit set drive everything. First, a category's own live peers
// are evidence: their median market-cap / TVL ratio says what the market pays for that kind of
// protocol. Second, the multiple falls with size: a least-squares fit of log10(market cap / TVL)
// against log10(TVL) across the fit set slopes downward, so a $5B protocol does not earn the
// multiple of a $50M one. The multiple a row is priced with blends the two in log space — the
// category median, shrunk toward the size curve's prediction at the row's own TVL by the number
// of live peers the category actually has, so a thin category leans on the curve and a deep one
// stands on its own peers. Implied value = TVL x blended multiple x growth factor x maturity
// factor, as before; the growth factor now clamps the raw 7-day change to [-80%, +200%] before
// its saturating curve, and a missing change is treated as unknown (neutral factor, flagged on
// the dashboard), never as zero.
//
// The model grades itself, in the open. buildRadar runs a leave-one-out backtest on the fit set:
// every live protocol is priced by the other 127 and the fold error recorded, for three
// predictors — category medians alone (the previous model's method), the size curve alone, and
// the blend this board uses. The results ship in the dashboard's data and are printed on its
// methodology panel: on this snapshot the blend's median error is about 3.6x, which is why every
// row also carries a value range (the category's blended interquartile band) instead of
// pretending a point estimate is precise. The snapshot carries no fees or revenue figures, so
// this is a TVL model and says so; for categories where TVL is a weak denominator (derivatives,
// whose TVL is posted margin) the dashboard notes the limitation on the row itself.
//
// Filtering is published, not silent. A pre-token protocol reaches the board only if it is not a
// wrapped, staked, bridged, versioned or exchange product of something that already exists —
// the same product exclusions the house's watchlist rule states. In v3 every protocol set aside
// is listed in the dashboard data with the specific reason(s) it was set aside, and two classes
// are flagged rather than silently decided: curator and allocator protocols, whose vaults run on
// lending protocols that already have tokens (an own token is plausible; they are not derivative
// products, so they stay ranked, tagged "borderline"), and rows the snapshot gives no 7-day
// change or no listing date for (flagged, with the neutral treatment stated).

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's tunable constants, all stated on the dashboard's methodology panel. */
export interface Constants {
  /** Live peers pulling a category median toward the size curve (pseudo-count, log space). */
  shrink_peers: number;
  /** Peer ratios are winsorized at this percentile of all live ratios before medians. */
  winsorize_percentile: number;
  /** Effective multiple clamp, low and high. */
  multiple_min: number;
  multiple_max: number;
  /** Growth factor = 1 + growth_weight * tanh(clamped change_7d / 100). */
  growth_weight: number;
  /** Raw 7-day change is clamped to this range before the growth factor sees it. */
  growth_clamp_low: number;
  growth_clamp_high: number;
  /** Maturity factor spans [maturity_base, maturity_base + maturity_span] over maturity_days. */
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  /** Total board size cap, watchlist included. */
  board_cap: number;
}

export const CONSTANTS: Constants = {
  shrink_peers: 8,
  winsorize_percentile: 90,
  multiple_min: 0.02,
  multiple_max: 1.5,
  growth_weight: 0.6,
  growth_clamp_low: -80,
  growth_clamp_high: 200,
  maturity_base: 0.7,
  maturity_span: 0.3,
  maturity_days: 1095,
  board_cap: 300,
};

export const MODEL_ID = 'comparables-curve-3';

/** Categories that name a product of another protocol rather than a protocol of its own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Plain-language reason for each product category, published with the exclusion list. */
const PRODUCT_CATEGORY_REASONS: Record<string, string> = {
  Bridge: 'Category is Bridge: a bridge moves assets that already exist; it is not itself a token launch waiting to happen.',
  'Canonical Bridge': 'Category is Canonical Bridge: a canonical bridge holds other protocols\u2019 assets in custody; it is not a launch candidate.',
  'Liquid Staking': 'Category is Liquid Staking: a staking product whose receipt stands for an asset that already trades.',
  'Liquid Restaking': 'Category is Liquid Restaking: a restaking product built on staking receipts of assets that already trade.',
  'Restaked BTC': 'Category is Restaked BTC: a product of bitcoin that already trades, not a new protocol token.',
  CEX: 'Category is CEX: an exchange\u2019s own listing or balance sheet, not a protocol awaiting a token launch.',
};

/** A name ending in a release marker is one version of another protocol, not a new launch. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product in a protocol's name. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names: a product that begins with one is that exchange's product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Curator and allocator protocols: vault businesses run on top of lending protocols that
 * already have tokens. Not derivative products — an own token is plausible — so they are
 * ranked, but the dashboard tags them borderline and says why.
 */
const BORDERLINE_CATEGORIES = new Set(['Risk Curators', 'Onchain Capital Allocator']);
const BORDERLINE_NOTE =
  'Borderline: a curator/allocator whose vaults run on lending protocols that already have tokens. An own token is plausible and it is not a derivative product, so it stays ranked — flagged, not silently decided.';

/** Categories where TVL is a weak pricing denominator, stated on the row. */
const TVL_NOTES: Record<string, string> = {
  Derivatives:
    'TVL here is posted margin, a weak denominator: fees or open interest would price a derivatives venue better, but the snapshot carries neither, so this row is priced on TVL like the rest and flagged for it.',
};

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The specific reasons a protocol is a product of something that already exists, in plain
 * language, for the published exclusion list. An empty list means it is not a product.
 */
export function productReasons(p: Protocol): string[] {
  const reasons: string[] = [];
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    reasons.push(PRODUCT_CATEGORY_REASONS[p.category] ?? `Category is ${p.category}: a product of another protocol, not a launch candidate.`);
  }
  if (VERSION_SUFFIX.test(p.name)) {
    reasons.push(`Name "${p.name}" ends in a version marker: one version of another protocol, not a new launch.`);
  }
  const word = p.name.match(PRODUCT_WORD);
  if (word !== null) {
    reasons.push(`Name contains "${word[0]}": a wrapped or staked product of an asset that already trades.`);
  }
  const exchange = p.name.match(EXCHANGE_PREFIX);
  if (exchange !== null) {
    reasons.push(`Name begins with ${exchange[1]}: that exchange\u2019s own product, not an independent launch.`);
  }
  return reasons;
}

/** A wrapped, staked, bridged, versioned or exchange product of something that already exists. */
export function isProduct(p: Protocol): boolean {
  return productReasons(p).length > 0;
}

/** Whole days from listed_at to the snapshot's as_of, or null when the record gives no date. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank quantile of an ascending-sorted array, the same rule the winsorize cap uses. */
function quantileSorted(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Least-squares fit of y on x, returned as intercept and slope. */
function linfit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** One live-token protocol usable as pricing evidence: a token, a market cap and a TVL. */
interface FitPeer {
  p: Protocol;
  ratio: number; // winsorized market cap / TVL
  raw_ratio: number;
}

/** One category's live-peer evidence. */
export interface CategoryEvidence {
  category: string;
  live_peers: number;
  peer_median: number | null;
  peer_q25: number | null;
  peer_q75: number | null;
}

/** The leave-one-out backtest: how each predictor priced the fit set's own protocols. */
export interface Backtest {
  fit_protocols: number;
  category_median_fold: number;
  curve_median_fold: number;
  blended_median_fold: number;
  blended_within_2x_pct: number;
  blended_within_3x_pct: number;
}

/** Everything the calibration derives from the fit set. */
export interface Calibration {
  fit: FitPeer[];
  winsorize_cap: number;
  curve: { a: number; b: number };
  byCategory: Map<string, CategoryEvidence>;
  backtest: Backtest;
}

const foldError = (pred: number, actual: number): number => Math.max(pred / actual, actual / pred);

/**
 * Calibrate the model on the snapshot's own live-token protocols: winsorize their ratios,
 * fit the size curve, summarise each category's peers, then backtest three predictors
 * leave-one-out so the dashboard can print the model's measured error, not a claim.
 */
export function calibrate(snapshot: Snapshot, c: Constants): Calibration {
  const fitRaw: FitPeer[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(raw) || raw <= 0) continue;
    fitRaw.push({ p, ratio: raw, raw_ratio: raw });
  }
  const sortedRatios = fitRaw.map((f) => f.raw_ratio).sort((a, b) => a - b);
  const cap = sortedRatios.length > 0 ? quantileSorted(sortedRatios, c.winsorize_percentile / 100) : 1;
  const fit: FitPeer[] = fitRaw.map((f) => ({ ...f, ratio: Math.min(f.raw_ratio, cap) }));

  const curve = linfit(
    fit.map((f) => Math.log10(f.p.tvl_usd)),
    fit.map((f) => Math.log10(f.ratio)),
  );
  const curveAt = (tvl: number): number => 10 ** (curve.a + curve.b * Math.log10(Math.max(1, tvl)));

  const perCategory = new Map<string, number[]>();
  for (const f of fit) {
    const key = f.p.category ?? 'Uncategorised';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [f.ratio]);
    else list.push(f.ratio);
  }
  const byCategory = new Map<string, CategoryEvidence>();
  const keys = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Uncategorised'))].sort();
  for (const key of keys) {
    const ratios = [...(perCategory.get(key) ?? [])].sort((a, b) => a - b);
    byCategory.set(key, {
      category: key,
      live_peers: ratios.length,
      peer_median: ratios.length > 0 ? round6(median(ratios)) : null,
      peer_q25: ratios.length > 0 ? round6(quantileSorted(ratios, 0.25)) : null,
      peer_q75: ratios.length > 0 ? round6(quantileSorted(ratios, 0.75)) : null,
    });
  }

  // Leave-one-out backtest. Each live protocol is priced by the other fit protocols only:
  // category medians shrunk to the global median (the previous model's method), the size
  // curve refit without it, and this model's blend of the two. Errors are fold errors
  // against the protocol's actual, unwinsorized ratio.
  const catErr: number[] = [];
  const curveErr: number[] = [];
  const blendErr: number[] = [];
  for (let i = 0; i < fit.length; i++) {
    const self = fit[i]!;
    const others = fit.filter((_, j) => j !== i);
    const globalMed = median(others.map((f) => f.ratio));
    const catOthers = others.filter((f) => (f.p.category ?? 'Uncategorised') === (self.p.category ?? 'Uncategorised'));
    const catMed = catOthers.length > 0 ? median(catOthers.map((f) => f.ratio)) : null;
    const catPred =
      catMed === null ? globalMed : (catOthers.length * catMed + c.shrink_peers * globalMed) / (catOthers.length + c.shrink_peers);
    const refit = linfit(
      others.map((f) => Math.log10(f.p.tvl_usd)),
      others.map((f) => Math.log10(f.ratio)),
    );
    const curvePred = 10 ** (refit.a + refit.b * Math.log10(self.p.tvl_usd));
    const blendPred =
      catMed === null
        ? curvePred
        : 10 ** ((catOthers.length * Math.log10(catMed) + c.shrink_peers * Math.log10(curvePred)) / (catOthers.length + c.shrink_peers));
    catErr.push(foldError(catPred, self.raw_ratio));
    curveErr.push(foldError(curvePred, self.raw_ratio));
    blendErr.push(foldError(blendPred, self.raw_ratio));
  }
  const backtest: Backtest = {
    fit_protocols: fit.length,
    category_median_fold: round2(median(catErr)),
    curve_median_fold: round2(median(curveErr)),
    blended_median_fold: round2(median(blendErr)),
    blended_within_2x_pct: Math.round((100 * blendErr.filter((e) => e <= 2).length) / Math.max(1, blendErr.length)),
    blended_within_3x_pct: Math.round((100 * blendErr.filter((e) => e <= 3).length) / Math.max(1, blendErr.length)),
  };

  return { fit, winsorize_cap: round6(cap), curve: { a: round4(curve.a), b: round4(curve.b) }, byCategory, backtest };
}

/** The size curve's predicted multiple at a TVL, before clamping. */
function curveMultiple(cal: Calibration, tvl: number): number {
  return 10 ** (cal.curve.a + cal.curve.b * Math.log10(Math.max(1, tvl)));
}

/**
 * Blend one category statistic (median, or a quartile for the range) with the size curve in
 * log space: the statistic is weighted by the peers behind it, the curve by shrink_peers.
 * With no peers in the category, the curve speaks alone.
 */
function blendedStat(cal: Calibration, ev: CategoryEvidence | undefined, stat: number | null, tvl: number, c: Constants): number {
  const curvePred = curveMultiple(cal, tvl);
  if (ev === undefined || stat === null || ev.live_peers === 0) return curvePred;
  return 10 ** ((ev.live_peers * Math.log10(stat) + c.shrink_peers * Math.log10(curvePred)) / (ev.live_peers + c.shrink_peers));
}

/** The factors, the implied value and the value range one protocol earns under the model. */
export interface Scored {
  implied_value_usd: number;
  range_low_usd: number;
  range_high_usd: number;
  range_basis: 'iqr' | 'backtest';
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  age_days: number | null;
}

export function scoreProtocol(p: Protocol, asOf: string, cal: Calibration, c: Constants): Scored {
  const ev = cal.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = clamp(blendedStat(cal, ev, ev?.peer_median ?? null, p.tvl_usd, c), c.multiple_min, c.multiple_max);
  const age = ageInDays(asOf, p.listed_at);
  const growthFactor =
    p.change_7d === null ? 1 : 1 + c.growth_weight * Math.tanh(clamp(p.change_7d, c.growth_clamp_low, c.growth_clamp_high) / 100);
  const ageForMaturity = age ?? c.maturity_days / 3;
  const maturityFactor =
    c.maturity_base + (Math.min(Math.max(ageForMaturity, 0), c.maturity_days) / c.maturity_days) * c.maturity_span;
  const value = (m: number): number => Math.max(1, Math.round(p.tvl_usd * m * growthFactor * maturityFactor));
  const implied = value(multiple);
  // The range: the category's blended interquartile band. A category with no usable quartiles
  // falls back to the model's own measured median fold error around the central estimate.
  let low: number;
  let high: number;
  let basis: 'iqr' | 'backtest';
  if (ev !== undefined && ev.peer_q25 !== null && ev.peer_q75 !== null && ev.live_peers >= 4) {
    low = value(clamp(blendedStat(cal, ev, ev.peer_q25, p.tvl_usd, c), c.multiple_min, c.multiple_max));
    high = value(clamp(blendedStat(cal, ev, ev.peer_q75, p.tvl_usd, c), c.multiple_min, c.multiple_max));
    basis = 'iqr';
  } else {
    const fold = Math.max(1.5, cal.backtest.blended_median_fold);
    low = Math.max(1, Math.round(implied / fold));
    high = Math.round(implied * fold);
    basis = 'backtest';
  }
  return {
    implied_value_usd: implied,
    range_low_usd: Math.min(low, implied),
    range_high_usd: Math.max(high, implied),
    range_basis: basis,
    category_multiple: round6(multiple),
    growth_factor: round6(growthFactor),
    maturity_factor: round6(maturityFactor),
    age_days: age,
  };
}

/** Capital a small farmer puts to work, scaled to the protocol's own size. */
function capitalTier(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** Typical all-in gas for one transaction on a chain, in whole dollars, and its speed class. */
function chainCost(chain: string): { gas: number; kind: string } {
  const name = chain.toLowerCase();
  if (name === 'ethereum') return { gas: 6, kind: 'Ethereum mainnet, the priciest leg' };
  if (name.includes('bitcoin') || name.includes('tron')) return { gas: 2, kind: 'a low-fee chain' };
  if (name.includes('solana')) return { gas: 1, kind: 'Solana, near-zero fees' };
  return { gas: 1, kind: 'an L2 or low-fee chain' };
}

/** What one protocol's whole farm programme costs, and whether the costs leave it worth doing. */
export interface FarmEconomics {
  capital_usd: number;
  gas_usd: number;
  total_cost_usd: number;
  cost_ratio: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

export function farmEconomics(p: Protocol, age: number | null): FarmEconomics {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalTier(p.tvl_usd);
  const { gas } = chainCost(chain);
  const hold = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  const weeks = Math.ceil(hold / 7);
  // Fund and approve (2x gas up front), the core action (1x), one small action a week, a claim (1x).
  const total = gas * 2 + gas + gas * weeks + gas;
  const ratio = total / capital;
  // Stated on the methodology panel: gas at or under a tenth of the working capital is
  // noise (FARM); up to three tenths is a real drag that only a strong candidate justifies
  // (THIN); past that, the gas eats the farm (SKIP).
  const verdict = ratio <= 0.1 ? 'FARM' : ratio <= 0.3 ? 'THIN' : 'SKIP';
  return { capital_usd: capital, gas_usd: gas, total_cost_usd: total, cost_ratio: round4(ratio), verdict };
}

/** The core qualifying action for a category, written for a farmer, not a marketer. */
function coreAction(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow about 40% against it and re-supply the borrowed half once, so both sides of the market see your wallet`;
  if (c.includes('dex') || c.includes('liquidity'))
    return `Add $${capital} of liquidity to ${n}'s busiest USDC pool on ${chain} and make two small swaps through the same interface in the first week`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC margin on ${n} and trade about $${capital * 5} of total volume across at least four sessions, hedging the directional risk`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return `Deposit $${capital} into one ${n} vault on ${chain}, keep the vault shares in the same wallet, and compound the yield back in once a month`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet past two monthly distributions`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the underlying asset through ${n} on ${chain} and keep the staking receipt unstaked and unspent in the same wallet`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds in one app on the far side instead of bridging straight back`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take positions in at least three different markets on ${n}, settling each one before opening the next`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for a position you actually hold, and keep the policy active for its full term`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${n} on ${chain} and hold or lend it for the full holding window below`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own interface and keep the position open for the full holding window below`;
}

/**
 * A farm plan for one protocol: eight concrete steps, each carrying its cost and its time,
 * ending in a verdict that nets the programme's gas against its working capital. Everything
 * in the plan derives from the protocol's own record — category, first chain, TVL and age —
 * so the same builder writes every row's plan and no name is hand-written.
 */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const econ = farmEconomics(p, age);
  const capital = econ.capital_usd;
  const { gas, kind } = chainCost(chain);
  const hold = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  const weeklyGas = Math.max(1, gas);
  const pct = Math.round(econ.cost_ratio * 100);
  const steps = [
    `Set up one fresh wallet for ${p.name} alone, fund it with $${capital + gas * 4} on ${chain}, and store its seed phrase offline. Cost: about $${gas * 2} in gas to fund and approve. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of working capital plus about $${gas} in gas on ${kind}. Time: 20 minutes to set up.`,
    `Repeat one small qualifying action every week — a deposit, a swap, a vote or a claim — so the wallet shows a pattern, not a single visit. Cost: about $${weeklyGas} in gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without moving it to another wallet, so it appears in several weekly snapshots. Cost: the $${capital} stays locked and exposed to the protocol's own risk. Time: ${hold} days.`,
    `Check ${p.name}'s own site and community channels once a week for a points, rewards or snapshot announcement, and screenshot any balance page that shows your position. Cost: nothing. Time: 5 minutes a week.`,
    `If a points programme or a token claim opens, claim only through the link the protocol publishes on its own site, and never pay a third party to claim for you. Cost: about $${gas} in gas if a claim opens, zero until then. Time: 15 minutes.`,
    `Keep a farm log with the wallet address, every date, amount and transaction hash, and unwind the position within a week of any token distribution or programme end. Cost: nothing but the log. Time: 10 minutes a week.`,
    `Verdict: ${econ.verdict} — the whole programme costs about $${econ.total_cost_usd} in gas against $${capital} of working capital (${pct}%). No protocol on this board has promised a token, and any points may convert to nothing: farm only money you can leave locked.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  farm_steps: string[];
}

/** A board row plus everything the dashboard shows that board.json does not carry. */
export interface DashRow extends BoardRow {
  range_low_usd: number;
  range_high_usd: number;
  range_basis: 'iqr' | 'backtest';
  curve_multiple: number;
  peer_median: number | null;
  live_peers: number;
  farm_verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  farm_capital_usd: number;
  notes: string[];
}

/** A pre-token protocol set aside before ranking, with the reason(s), published in full. */
export interface Exclusion {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reasons: string[];
}

/** One live peer shown in a protocol's detail view: the comparables behind its price. */
export interface Comparable {
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** A live-token protocol, set aside from the ranking: the market already prices it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_id: string;
  constants: Constants;
  winsorize_cap: number;
  curve: { a: number; b: number };
  backtest: Backtest;
  multiples: CategoryEvidence[];
  comparables: Record<string, Comparable[]>;
  counts: {
    protocols: number;
    pre_token: number;
    products_set_aside: number;
    watchlist: number;
    board: number;
    early: number;
    live: number;
    borderline: number;
  };
  rows: DashRow[];
  exclusions: Exclusion[];
  live: LiveRow[];
}

/** Build the ranked board and the dashboard's dataset from one snapshot. */
export function buildRadar(snapshot: Snapshot, c: Constants = CONSTANTS): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot, c);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);

  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const earlyPool = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && recordsNoToken(p) && !isProduct(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (const p of earlyPool) {
    if (chosen.size >= c.board_cap) break;
    chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const s = scoreProtocol(p, snapshot.as_of, cal, c);
    const econ = farmEconomics(p, s.age_days);
    const ev = cal.byCategory.get(p.category ?? 'Uncategorised');
    const notes: string[] = [];
    if (p.category !== null && BORDERLINE_CATEGORIES.has(p.category)) notes.push(BORDERLINE_NOTE);
    if (p.category !== null && TVL_NOTES[p.category] !== undefined) notes.push(TVL_NOTES[p.category]!);
    if (p.change_7d === null) notes.push('The snapshot reports no 7-day TVL change for this protocol: the growth factor is neutral (1.00), not zero.');
    if (p.listed_at === null) notes.push('The snapshot reports no listing date: the maturity factor assumes one year tracked, and the farm plan assumes a 45-day hold.');
    return { p, s, econ, ev, notes };
  });
  scored.sort((a, b) => b.s.implied_value_usd - a.s.implied_value_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: DashRow[] = scored.map((x, i) => ({
    rank: i + 1,
    slug: x.p.slug,
    name: x.p.name,
    category: x.p.category,
    chains: x.p.chains,
    tvl_usd: x.p.tvl_usd,
    change_7d: x.p.change_7d,
    listed_at: x.p.listed_at,
    age_days: x.s.age_days,
    on_watchlist: watch.has(x.p.slug),
    implied_value_usd: x.s.implied_value_usd,
    category_multiple: x.s.category_multiple,
    growth_factor: x.s.growth_factor,
    maturity_factor: x.s.maturity_factor,
    farm_steps: farmPlan(x.p, x.s.age_days),
    range_low_usd: x.s.range_low_usd,
    range_high_usd: x.s.range_high_usd,
    range_basis: x.s.range_basis,
    curve_multiple: round4(clamp(curveMultiple(cal, x.p.tvl_usd), c.multiple_min, c.multiple_max)),
    peer_median: x.ev?.peer_median ?? null,
    live_peers: x.ev?.live_peers ?? 0,
    farm_verdict: x.econ.verdict,
    farm_cost_usd: x.econ.total_cost_usd,
    farm_capital_usd: x.econ.capital_usd,
    notes: x.notes,
  }));

  // board.json carries exactly the fields it carried in the previous model: the range, the
  // verdict and the notes are dashboard data, derived from the same run.
  const board: BoardRow[] = rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    on_watchlist: r.on_watchlist,
    implied_value_usd: r.implied_value_usd,
    category_multiple: r.category_multiple,
    growth_factor: r.growth_factor,
    maturity_factor: r.maturity_factor,
    farm_steps: r.farm_steps,
  }));

  // Every pre-token protocol that did not reach the board, with its reason(s), biggest first.
  const exclusions: Exclusion[] = snapshot.protocols
    .filter((p) => recordsNoToken(p) && !chosen.has(p.slug))
    .map((p) => {
      const reasons = productReasons(p);
      if (reasons.length === 0) reasons.push('Eligible, but below this board\u2019s cut: the board is capped and larger eligible protocols rank ahead of it.');
      return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reasons };
    })
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  // The comparables behind each board category: its five largest live peers by market cap.
  const comparables: Record<string, Comparable[]> = {};
  const boardCategories = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  for (const key of boardCategories) {
    comparables[key] = cal.fit
      .filter((f) => (f.p.category ?? 'Uncategorised') === key)
      .sort((a, b) => (b.p.mcap_usd ?? 0) - (a.p.mcap_usd ?? 0) || (a.p.slug < b.p.slug ? -1 : 1))
      .slice(0, 5)
      .map((f) => ({ name: f.p.name, mcap_usd: f.p.mcap_usd ?? 0, tvl_usd: f.p.tvl_usd, ratio: round2(f.raw_ratio) }));
  }

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 40)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_id: MODEL_ID,
    constants: c,
    winsorize_cap: cal.winsorize_cap,
    curve: cal.curve,
    backtest: cal.backtest,
    multiples: [...cal.byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : 1)),
    comparables,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      products_set_aside: exclusions.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !r.on_watchlist).length,
      live: live.length,
      borderline: rows.filter((r) => r.category !== null && BORDERLINE_CATEGORIES.has(r.category)).length,
    },
    rows,
    exclusions,
    live,
  };
  return { board, radar };
}

/** Parse and validate the sealed snapshot's shape before scoring it. */
export function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist');
  const protocols: Protocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') throw new Error(`protocol ${i} lacks slug, name or tvl_usd`);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((x): x is string => typeof x === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The gate's shape, checked before anything is written: null when the board is valid. */
export function boardProblem(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'board holds a duplicate slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `board names unknown slug ${r.slug}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${r.slug} outranks the row above it`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000)
      return `row ${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/** The dashboard's data as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
