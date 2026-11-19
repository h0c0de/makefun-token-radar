// Token Launch Radar — valuation model (model id "peer-multiple-2").
//
// One sealed DefiLlama snapshot in, one ranked board out. Every number on the board is a pure
// function of the snapshot's own figures: no protocol name is ever special-cased, no wall clock
// is read (ages are measured against the snapshot's own as_of date), and no randomness is used,
// so two runs over the same snapshot write byte-identical output.
//
// The model, in one paragraph. A protocol that records no token is valued the way the market
// already values its live peers: implied = TVL x category multiple x growth factor x maturity
// factor. The category multiple is not a constant anyone picked: it is the median market-cap /
// TVL ratio of the snapshot's own live-token protocols in the same category, shrunk toward the
// global median when a category has few live peers, so a thin category cannot produce a wild
// multiple. Peer ratios are winsorized at the live universe's own 90th percentile first: a
// live protocol whose market cap is 400x its TVL is a market anomaly (a tiny TVL denominator),
// not evidence about its whole category, and no single peer may drag a category to the clamp.
// The growth factor rewards seven-day TVL momentum through a saturating curve, so a freak
// +4,000% week counts as strong momentum, not as a 40x valuation. The maturity factor pays a
// bounded premium for time survived with no token: a protocol tracked for three years has a
// track record a three-week one does not.
//
// The board covers the snapshot's whole watchlist (the floor, never the ceiling) and adds the
// strongest early protocols below the floor: pre-token, and not a wrapped, staked, bridged or
// versioned product of something else — the same product exclusions the house's watchlist rule
// states, applied to the early set as well, because a wrapped product of a token that already
// trades is not a launch that has not happened yet.

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
  /** Live peers pulling a category median toward the global median (pseudo-count). */
  shrink_peers: number;
  /** Peer ratios are winsorized at this percentile of all live ratios before medians. */
  winsorize_percentile: number;
  /** Category multiple clamp, low and high. */
  multiple_min: number;
  multiple_max: number;
  /** Growth factor = 1 + growth_weight * tanh(change_7d / 100). */
  growth_weight: number;
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
  maturity_base: 0.7,
  maturity_span: 0.3,
  maturity_days: 1095,
  board_cap: 300,
};

export const MODEL_ID = 'peer-multiple-2.1';

/** Categories that name a product of another protocol rather than a protocol of its own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name ending in a release marker is one version of another protocol, not a new launch. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product in a protocol's name. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names: a product that begins with one is that exchange's product, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A wrapped, staked, bridged, versioned or exchange product of something that already exists. */
export function isProduct(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
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

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** One category's calibrated multiple and the evidence behind it. */
export interface CategoryMultiple {
  category: string;
  live_peers: number;
  peer_median: number | null;
  multiple: number;
}

/**
 * The multiple table: for every category, the median market-cap / TVL of its live-token
 * protocols in this snapshot, shrunk toward the global live median by shrink_peers.
 * Categories with no live peers fall back to the global median outright.
 */
export function calibrateMultiples(snapshot: Snapshot, c: Constants): { global: number; winsorize_cap: number; byCategory: Map<string, CategoryMultiple> } {
  const rawRatios: { key: string; ratio: number }[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    rawRatios.push({ key: p.category ?? 'Uncategorised', ratio });
  }
  // Winsorize at the live universe's own high percentile: extreme ratios keep their rank as
  // "large" but lose their power to set a category's level on their own.
  const sortedAll = rawRatios.map((r) => r.ratio).sort((a, b) => a - b);
  const cap =
    sortedAll.length > 0 ? sortedAll[Math.min(sortedAll.length - 1, Math.floor((c.winsorize_percentile / 100) * sortedAll.length))]! : 1;
  const liveRatios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const { key, ratio } of rawRatios) {
    const winsorized = Math.min(ratio, cap);
    liveRatios.push(winsorized);
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [winsorized]);
    else list.push(winsorized);
  }
  const global = liveRatios.length > 0 ? median(liveRatios) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  const keys = [...perCategory.keys(), ...new Set(snapshot.protocols.map((p) => p.category ?? 'Uncategorised'))].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  keys.sort();
  for (const key of keys) {
    const ratios = perCategory.get(key) ?? [];
    const peerMedian = ratios.length > 0 ? median(ratios) : null;
    const shrunk =
      peerMedian === null ? global : (ratios.length * peerMedian + c.shrink_peers * global) / (ratios.length + c.shrink_peers);
    byCategory.set(key, {
      category: key,
      live_peers: ratios.length,
      peer_median: peerMedian === null ? null : round6(peerMedian),
      multiple: round6(Math.min(c.multiple_max, Math.max(c.multiple_min, shrunk))),
    });
  }
  return { global: round6(global), winsorize_cap: round6(cap), byCategory };
}

/** The three factors and the implied value one protocol earns under the model. */
export interface Scored {
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  age_days: number | null;
}

export function scoreProtocol(p: Protocol, asOf: string, multiple: number, c: Constants): Scored {
  const age = ageInDays(asOf, p.listed_at);
  const growthFactor = p.change_7d === null ? 1 : 1 + c.growth_weight * Math.tanh(p.change_7d / 100);
  const ageForMaturity = age ?? c.maturity_days / 3;
  const maturityFactor =
    c.maturity_base + (Math.min(Math.max(ageForMaturity, 0), c.maturity_days) / c.maturity_days) * c.maturity_span;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * maturityFactor));
  return {
    implied_value_usd: implied,
    category_multiple: multiple,
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
 * A farm plan for one protocol: seven concrete steps, each carrying its cost and its time.
 * Everything in the plan derives from the protocol's own record — category, first chain,
 * TVL and age — so the same builder writes every row's plan and no name is hand-written.
 */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalTier(p.tvl_usd);
  const { gas, kind } = chainCost(chain);
  const hold = age === null ? 45 : age < 180 ? 60 : age < 730 ? 45 : 30;
  const weeklyGas = Math.max(1, gas);
  const steps = [
    `Set up one fresh wallet for ${p.name} alone, fund it with $${capital + gas * 4} on ${chain}, and store its seed phrase offline. Cost: about $${gas * 2} in gas to fund and approve. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of working capital plus about $${gas} in gas on ${kind}. Time: 20 minutes to set up.`,
    `Repeat one small qualifying action every week — a deposit, a swap, a vote or a claim — so the wallet shows a pattern, not a single visit. Cost: about $${weeklyGas} in gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without moving it to another wallet, so it appears in several weekly snapshots. Cost: the $${capital} stays locked and exposed to the protocol's own risk. Time: ${hold} days.`,
    `Check ${p.name}'s own site and community channels once a week for a points, rewards or snapshot announcement, and screenshot any balance page that shows your position. Cost: nothing. Time: 5 minutes a week.`,
    `If a points programme or a token claim opens, claim only through the link the protocol publishes on its own site, and never pay a third party to claim for you. Cost: about $${gas} in gas if a claim opens, zero until then. Time: 15 minutes.`,
    `Keep a farm log with the wallet address, every date, amount and transaction hash, and unwind the position within a week of any token distribution or programme end. Cost: nothing but the log. Time: 10 minutes a week.`,
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
  global_multiple: number;
  winsorize_cap: number;
  multiples: CategoryMultiple[];
  counts: { protocols: number; pre_token: number; products_set_aside: number; watchlist: number; board: number; early: number; live: number };
  rows: BoardRow[];
  live: LiveRow[];
}

/** Build the ranked board and the dashboard's dataset from one snapshot. */
export function buildRadar(snapshot: Snapshot, c: Constants = CONSTANTS): { board: BoardRow[]; radar: RadarData } {
  const { global, winsorize_cap, byCategory } = calibrateMultiples(snapshot, c);
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
    const multiple = byCategory.get(p.category ?? 'Uncategorised')?.multiple ?? global;
    return { p, ...scoreProtocol(p, snapshot.as_of, multiple, c) };
  });
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age_days,
    on_watchlist: watch.has(s.p.slug),
    implied_value_usd: s.implied_value_usd,
    category_multiple: s.category_multiple,
    growth_factor: s.growth_factor,
    maturity_factor: s.maturity_factor,
    farm_steps: farmPlan(s.p, s.age_days),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 40)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const products = snapshot.protocols.filter((p) => recordsNoToken(p) && isProduct(p) && !watch.has(p.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_id: MODEL_ID,
    constants: c,
    global_multiple: global,
    winsorize_cap,
    multiples: [...byCategory.values()].sort((a, b) => (a.category < b.category ? -1 : 1)),
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      products_set_aside: products,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !r.on_watchlist).length,
      live: live.length,
    },
    rows: board,
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
