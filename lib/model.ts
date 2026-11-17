// Token launch radar: the model.
//
// The snapshot is all this program ever reads: every protocol DefiLlama
// tracked at $5M TVL or more on the fetch date, with its TVL, its seven-day
// TVL change, the day tracking began, and the market cap of its token where
// it records one. The radar's job is to find the protocols that record no
// token yet, say what a launch would be worth if their record stayed as it
// is, and tell a reader how to farm each one before it issues.
//
// The implied value is a formula, never a list of names:
//
//   implied = TVL x category multiple x momentum x maturity
//
// The category multiple is learned from the snapshot itself: for each
// category, take every protocol in it whose token already trades and use
// the median of its market-cap-to-TVL ratios, shrunk toward the global
// median when the category has few traded tokens to learn from. Momentum
// rewards a protocol whose TVL grew over the last seven days and discounts
// one that shrank. Maturity pays a small premium for a long record: a
// protocol tracked for years with no token has had every chance to issue,
// so the launch it still owes is the more credible for the wait.

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

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  multiple_source: 'category' | 'global';
  momentum: number;
  maturity: number;
  watchlist: boolean;
}

export interface Radar {
  meta: {
    as_of: string;
    floor_usd: number;
    protocols_seen: number;
    pre_token: number;
    board_rows: number;
    watchlist_size: number;
    global_multiple: number;
    model: string;
  };
  rows: RadarRow[];
}

/** Parse and lightly validate the sealed snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist');
  }
  return raw;
}

/** Categories that are a wrapped, staked or bridged product of a traded token. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * True when the protocol is a wrapped, staked or bridged product of a token
 * that already trades, by the same reading the house's watchlist uses: such
 * a product is not waiting on a launch of its own.
 */
export function isProductOfTraded(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  return EXCHANGE_PREFIX.some((x) => p.name.startsWith(x));
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples, learned from the snapshot's traded tokens: the
 * median market-cap-to-TVL ratio of each category, shrunk toward the
 * global median by the count behind it, so a category with four traded
 * tokens borrows half of its multiple from the whole field and one with
 * twenty stands mostly on its own. A category with fewer than three
 * traded tokens gets no multiple of its own: one protocol's ratio is an
 * anecdote, not a market, and the global median speaks for it instead.
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = median(all);
  const byCategory = new Map<string, number>();
  for (const [key, list] of ratios) {
    if (list.length < 3) continue;
    const shrunk = (list.length * median(list) + 4 * global) / (list.length + 4);
    byCategory.set(key, Math.min(1.5, Math.max(0.02, shrunk)));
  }
  return { byCategory, global };
}

/** Whole days between two UTC dates (YYYY-MM-DD), or null when either is missing. */
export function ageInDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Seven-day TVL momentum as a multiplier: growth pays, shrinkage costs, capped both ways. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const clamped = Math.min(40, Math.max(-40, change7d));
  return 1 + (clamped / 100) * 0.6;
}

/** A long tokenless record earns a small premium; an untracked age is neutral. */
export function maturityFactor(ageDays: number | null): number {
  if (ageDays === null) return 1;
  const share = Math.min(ageDays, 1825) / 1825;
  return 0.9 + 0.2 * share;
}

/** Gas and fee wording for a chain, so a farm plan can state what a step costs. */
export function chainCost(chain: string): string {
  if (chain === 'Ethereum') return 'about $15-40 in mainnet gas';
  if (chain === 'Solana') return 'under $0.10 in network fees';
  if (['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Taiko'].includes(chain)) {
    return 'about $1-5 in layer-2 gas';
  }
  if (['BSC', 'Polygon', 'Avalanche', 'Fantom', 'Gnosis'].includes(chain)) return 'about $0.10-2 in network fees';
  return 'about $2-10 in network fees';
}

/**
 * The farm plan for one protocol: concrete steps in its own category, on
 * its own first chain, with what each step costs and how long it takes.
 * Points programs reward real, repeated use, so every plan is built as
 * open, use, repeat, track, and be ready to claim.
 */
export function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const cost = chainCost(chain);
  const name = p.name;
  const open = `Open ${name} on ${chain} and connect a wallet you control; fund it with the asset the protocol takes plus enough of the chain's gas token to transact, ${cost} for the first session, about 15 minutes to set up.`;
  const track = `Keep a simple log of every deposit, trade and point balance in ${name}, and re-check the position weekly for about 15 minutes; consistent weekly activity over months is what launch snapshots usually reward, not one large deposit.`;
  const ready = `Watch ${name}'s own announcements for a points season or launch post, and keep the wallet's activity unbroken until then; when a claim opens, act in the first days, since claim windows are short and unclaimed allocations are usually burned.`;
  const cat = p.category ?? '';
  let use: string;
  let repeat: string;
  if (cat === 'Dexs') {
    use = `Make real swaps on ${name} on ${chain} in the pairs you would trade anyway, starting with $100-500 per swap; each swap costs ${cost}, and varied pairs and sizes read as genuine use rather than wash volume.`;
    repeat = `Add a two-sided liquidity position in a busy pair on ${name} and leave it working for at least a month; providing depth is the activity most DEX launches weight heaviest, and the fees earned offset part of the gas spent.`;
  } else if (cat === 'Lending') {
    use = `Supply an asset you already hold to ${name} on ${chain}, keeping the position modest at first; supplying costs ${cost}, and supplied balances that stay put are the balance a lending launch snapshot can see.`;
    repeat = `Take a small, well-collateralised borrow against your supply and repay it in full within a few weeks; a clean borrow-and-repay history shows the protocol real credit use, and the interest on a small loan for a few weeks is a few dollars.`;
  } else if (cat === 'CDP') {
    use = `Deposit collateral into ${name} on ${chain} and mint its stablecoin against it, staying well above the liquidation line; opening the position costs ${cost}, and minted balances held over time are the usage that counts.`;
    repeat = `Hold part of the minted stablecoin in the protocol's own stability or savings pool rather than swapping it away at once; the longer the mint stays open and healthy, the stronger the record, for about 10 minutes of checks a week.`;
  } else if (cat === 'Risk Curators' || cat === 'Onchain Capital Allocator') {
    use = `Deposit into one of ${name}'s curated vaults on ${chain}, choosing a vault whose strategy you can explain; entering costs ${cost}, and vault shares held across weeks are the position a curator's launch would snapshot.`;
    repeat = `Spread a second, smaller deposit across a different vault or curator strategy in ${name} after the first month; breadth across strategies shows deliberate allocation, and moving between vaults costs ${cost} each time.`;
  } else if (cat === 'RWA') {
    use = `Complete ${name}'s onboarding and identity checks, then make the smallest subscription it allows on ${chain}; onboarding takes about 30 minutes once, and a real, settled position is what separates a holder from a browser.`;
    repeat = `Hold the position through at least one full reporting or yield cycle in ${name} and keep the account in good standing; real-world-asset launches reward holders who stayed through cycles, not accounts opened the week before.`;
  } else if (cat === 'Derivatives') {
    use = `Open small perpetual positions on ${name} on ${chain} in markets you understand, sized so a bad day costs little; each open and close costs ${cost}, and steady, real trading volume is the record a derivatives launch reads.`;
    repeat = `Trade on ${name} in most weeks rather than in one burst, and try more than one market over the season; a long, even history of modest volume is worth more than a single week of size, at about 20 minutes a session.`;
  } else if (cat === 'Chain') {
    use = `Bridge a working balance to ${name} and make it your active chain for a month: hold assets there, transact weekly, and use its native applications; bridging in costs ${cost}, and a chain's launch counts wallets that actually live on it.`;
    repeat = `Run your ordinary on-chain business through ${name} rather than a rival chain for the season, including at least one native application a week; breadth of contracts touched is a common airdrop screen and costs only the gas you would spend anyway.`;
  } else {
    use = `Put a working position into ${name} on ${chain} in the way its own interface leads with, sized to what you can leave for a season; entering costs ${cost}, and a position held over months is the record a launch snapshot can see.`;
    repeat = `Use ${name} again in most weeks, a second position, a second market or a renewal, rather than depositing once and leaving; repeated, varied use over time is what separates a farmer the protocol wants from a wallet passing through.`;
  }
  return [open, use, repeat, track, ready];
}

export interface BuiltRadar {
  board: BoardRow[];
  radar: Radar;
}

/**
 * Build the ranked board: every protocol that records no token and is not
 * a product of a traded one, valued by the model and ranked by value.
 */
export function buildRadar(snapshot: Snapshot): BuiltRadar {
  const { byCategory, global } = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const rows: RadarRow[] = [];
  let preToken = 0;
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) continue;
    preToken += 1;
    if (isProductOfTraded(p)) continue;
    const own = byCategory.get(p.category ?? 'Uncategorised');
    const multiple = own ?? global;
    const momentum = momentumFactor(p.change_7d);
    const age = ageInDays(p.listed_at, snapshot.as_of);
    const maturity = maturityFactor(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity));
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      multiple,
      multiple_source: own === undefined ? 'global' : 'category',
      momentum,
      maturity,
      watchlist: watchlist.has(p.slug),
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  const radar: Radar = {
    meta: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      protocols_seen: snapshot.protocols.length,
      pre_token: preToken,
      board_rows: rows.length,
      watchlist_size: snapshot.watchlist.length,
      global_multiple: global,
      model: 'implied = TVL x category multiple (median market-cap/TVL of the category\'s traded tokens, shrunk to the global median; categories with fewer than three traded tokens use the global median) x momentum (7d TVL change, capped) x maturity (days tracked with no token)',
    },
    rows,
  };
  return { board, radar };
}

/**
 * The gate's shape, checked before anything is written: returns the first
 * reason the board would be refused, or null when it is in shape.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i]!;
    if (row.rank !== i + 1) return `ranks are not exactly 1..N (rank ${row.rank} at position ${i + 1})`;
    if (!slugs.has(row.slug)) return `row ${row.slug} is not one of the snapshot's protocols`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug} has an out-of-range implied value`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data as a script the static page loads beside itself. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
