// Token Launch Radar — the model and the farm-plan composer.
// This file is the whole method, in one place, on purpose: the dashboard page
// loads it and runs it over the snapshot figures, and the build program runs
// the same functions to write board.json. One implementation, two runners, so
// the page, the screenshots and the board file cannot drift apart.
//
// Everything below is computed from the sealed snapshot's own fields:
// tvl_usd, change_7d, mcap_usd, listed_at, category, chains. The only numbers
// that do not come from the snapshot are the gas planning tiers at the bottom,
// and they are labelled as assumptions wherever they are shown.

// ---------------------------------------------------------------- utilities
// Deterministic helpers only: no clock, no locale, no randomness. Ordering
// ties always end at the slug, compared by code unit.

export const cmpSlug = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const spearman = (xs, ys) => {
  const rank = (vs) => {
    const order = vs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = new Array(vs.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let t = i; t <= j; t++) out[order[t][1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
};

// ------------------------------------------------------- board construction
// A protocol counts as pre-token only when the snapshot records no token for
// it at all: no market cap, no symbol, no gecko id. Rows that carry a symbol
// but no market cap are products of an already-traded parent (aave-v3 carries
// AAVE) and are counted separately in the funnel, never ranked.
//
// The board then drops products that mirror an existing traded thing, the
// same rule the official watchlist uses: whole categories that are wrappers
// or venues (CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC), names containing the whole word wrapped, staked
// or staking, names ending in a version marker, and names beginning with an
// exchange brand.

export const WRAPPER_CATEGORIES = ['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC'];
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function exclusionReason(p) {
  if (WRAPPER_CATEGORIES.includes(p.category)) return 'category';
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return 'name';
  if (/[\s\-](v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name.trim())) return 'name';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'name';
  return null;
}
export const recordsNoToken = (p) => p.mcap_usd === null && p.symbol === null && p.gecko_id === null;

// ------------------------------------------------------------------- chains
// Gas planning tiers, in USD per simple transaction. These are planning
// assumptions, not snapshot data; the methodology panel shows them as such.
export const GAS_TIERS = [
  { label: 'Ethereum mainnet', mid: 25, text: 'about $15-40 in mainnet gas per transaction' },
  { label: 'Low-cost chain', mid: 0.5, text: 'about $0.10-2 in gas per transaction' },
  { label: 'Major layer-2', mid: 2, text: 'about $1-5 in layer-2 gas per transaction' },
  { label: 'Solana', mid: 0.05, text: 'under $0.10 in fees per transaction' },
  { label: 'Other chain', mid: 5, text: 'about $2-10 in gas per transaction' },
];
const L2 = ['Arbitrum', 'Optimism', 'Base', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Taiko', 'Manta'];
const CHEAP = ['BSC', 'Polygon', 'Avalanche', 'Fantom', 'Gnosis', 'Celo', 'Moonbeam', 'Cronos', 'Aurora', 'Harmony'];
export function chainTier(chain) {
  if (chain === 'Ethereum') return GAS_TIERS[0];
  if (chain === 'Solana') return GAS_TIERS[3];
  if (L2.includes(chain)) return GAS_TIERS[2];
  if (CHEAP.includes(chain)) return GAS_TIERS[1];
  return GAS_TIERS[4];
}
export function cheapestChain(chains) {
  let best = null;
  for (const c of chains) {
    const t = chainTier(c);
    if (!best || t.mid < best.tier.mid) best = { chain: c, tier: t };
  }
  return best;
}

// ---------------------------------------------------------------- the model
// implied = TVL x category multiple x size factor x momentum x maturity
//
// Category multiple: the median mcap/TVL of the category's traded protocols,
// shrunk toward the global median in log space with weight n/(n+K), K = 4.
// Log space because the ratios are roughly log-normal; the smooth weight
// replaces any hard "too few comps" cutoff, so a category with one comp is
// mostly prior and a category with fifteen is mostly its own data. Multiples
// are clamped to the 5th-95th percentile band of all traded ratios.
//
// Size factor: market cap grows slower than TVL. A pooled log-log regression
// of mcap on TVL over the traded set gives elasticity beta; the multiple of a
// large protocol is scaled by (TVL / median traded TVL)^-(1-beta), with the
// exponent clamped to [0, 0.35]. Fitted at build time, printed in the panel.
//
// Momentum: the 7-day TVL change minus the snapshot-wide median change (the
// market fell 8.2% in the snapshot week, so a flat protocol outperformed).
// Excess is winsorized at its 5th-95th percentiles. The back-test below
// cannot distinguish weights 0, 0.5 and 1 (median errors within 2%), so the
// weight is a bounded prior of 0.5, disclosed as such, like maturity.
//
// Maturity: a concave curve in age since listing, 0.85 for a brand-new
// protocol rising to 1.25 at the cohort's 90th-percentile age. Long-running
// tokenless protocols carry accrued, unrewarded usage; past the plateau
// there is no extra evidence, so the curve stops. A missing listing date is
// imputed to the cohort median age and flagged. Maturity is a stated prior:
// a tokenless age cannot be back-tested from a snapshot, so it is bounded
// and disclosed rather than fitted.

export const K_SHRINK = 4;

function categoryStats(comps) {
  // comps: [{category, ratio}] with ratio > 0. Returns per-category aggregates
  // plus leave-one-out friendly sums of log ratios.
  const byCat = new Map();
  for (const c of comps) {
    const key = c.category ?? '(none)';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(c.ratio);
  }
  return byCat;
}

function shrunkMultiple(logRatios, globalLogMed, K) {
  const n = logRatios.length;
  if (n === 0) return { mult: Math.exp(globalLogMed), priorWeight: 1 };
  const sum = logRatios.reduce((a, b) => a + b, 0);
  return { mult: Math.exp((sum + K * globalLogMed) / (n + K)), priorWeight: K / (n + K) };
}

export function computeModel(protocols, asOf, overrides = {}) {
  const K = overrides.K ?? K_SHRINK;
  const asMs = Date.parse(asOf + 'T00:00:00Z');
  const traded = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const zeroMcap = protocols.filter((p) => p.mcap_usd === 0).length;
  const signalNoMcap = protocols.filter((p) => p.mcap_usd === null && !recordsNoToken(p)).length;
  const clean = protocols.filter(recordsNoToken);
  const excluded = { category: 0, name: 0 };
  const candidates = [];
  for (const p of clean) {
    const r = exclusionReason(p);
    if (r) excluded[r]++;
    else candidates.push(p);
  }

  const comps = traded.map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, mcap: p.mcap_usd, ratio: p.mcap_usd / p.tvl_usd, change_7d: p.change_7d }));
  const ratios = comps.map((c) => c.ratio);
  const logRatios = ratios.map((r) => Math.log(r));
  const globalLogMed = median(logRatios);
  const globalMult = Math.exp(globalLogMed);
  const bandLo = quantile(ratios, 0.05), bandHi = quantile(ratios, 0.95);
  const globalSpread = (Math.log(quantile(ratios, 0.75)) - Math.log(quantile(ratios, 0.25))) / 2;

  const byCat = categoryStats(comps);
  const categories = {};
  for (const [cat, rs] of [...byCat.entries()].sort((a, b) => cmpSlug(a[0], b[0]))) {
    const logs = rs.map((r) => Math.log(r));
    const { mult, priorWeight } = shrunkMultiple(logs, globalLogMed, K);
    const spread = (logs.length > 1
      ? (Math.log(quantile(rs, 0.75)) - Math.log(quantile(rs, 0.25))) / 2
      : globalSpread);
    const shrunkSpread = (logs.length * spread + K * globalSpread) / (logs.length + K);
    categories[cat] = {
      n: rs.length, rawMedian: median(rs), mult: clamp(mult, bandLo, bandHi),
      low: clamp(mult * Math.exp(-shrunkSpread), bandLo, bandHi), high: clamp(mult * Math.exp(shrunkSpread), bandLo, bandHi),
      priorWeight,
    };
  }
  const multOf = (cat) => categories[cat ?? '(none)'] ?? { n: 0, rawMedian: globalMult, mult: globalMult, low: globalMult * Math.exp(-globalSpread), high: globalMult * Math.exp(globalSpread), priorWeight: 1 };

  // Size elasticity: pooled OLS of ln(mcap) on ln(TVL) over the traded set.
  const xs = comps.map((c) => Math.log(c.tvl)), ys = comps.map((c) => Math.log(c.mcap));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const beta = sxy / sxx;
  const gamma = overrides.gamma ?? clamp(1 - beta, 0, 0.35);
  const compMedianTvl = median(comps.map((c) => c.tvl));

  // Market-relative momentum frame.
  const changes = protocols.map((p) => p.change_7d).filter((v) => v !== null);
  const marketMedian = median(changes);
  const excessAll = changes.map((v) => v - marketMedian);
  const excLo = quantile(excessAll, 0.05), excHi = quantile(excessAll, 0.95);

  // Age frame over the candidate cohort.
  const ages = candidates.map((p) => (p.listed_at ? (asMs - Date.parse(p.listed_at + 'T00:00:00Z')) / 864e5 : null));
  const knownAges = ages.filter((a) => a !== null);
  const medianAge = median(knownAges), p90Age = quantile(knownAges, 0.9);

  const frame = { K, gamma, beta, bandLo, bandHi, globalMult, marketMedian, excLo, excHi, medianAge, p90Age, compMedianTvl };

  function scoreRow(p, momW, frameOverride = frame) {
    const f = frameOverride;
    const cat = multOf(p.category);
    const mult = cat.mult;
    const size = Math.pow(p.tvl_usd / f.compMedianTvl, -f.gamma);
    const excessRaw = p.change_7d === null ? null : p.change_7d - f.marketMedian;
    const excess = excessRaw === null ? 0 : clamp(excessRaw, f.excLo, f.excHi);
    const momentum = 1 + (momW * excess) / 100;
    const ageDays = p.listed_at ? (asMs - Date.parse(p.listed_at + 'T00:00:00Z')) / 864e5 : null;
    const ageUsed = ageDays === null ? f.medianAge : ageDays;
    const x = Math.min(ageUsed / f.p90Age, 1);
    const maturity = 0.85 + 0.4 * (1 - (1 - x) * (1 - x));
    const implied = Math.max(1, Math.round(p.tvl_usd * mult * size * momentum * maturity));
    const low = Math.max(1, Math.round((implied * cat.low) / mult));
    const high = Math.round((implied * cat.high) / mult);
    return {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, listed_at: p.listed_at, ageDays: ageDays === null ? null : Math.round(ageDays),
      mult, size, momentum, maturity, excess: excessRaw, implied, low, high,
      compsN: cat.n, priorWeight: cat.priorWeight,
      clamped: mult <= bandLo || mult >= bandHi,
      ageImputed: ageDays === null, changeMissing: p.change_7d === null,
      managedTvl: p.category === 'Risk Curators' || p.category === 'Onchain Capital Allocator',
    };
  }

  // -------------------------------------------- leave-one-out back-test
  // Each traded protocol's market cap is predicted from the model fitted
  // without it. The momentum weight is the grid value with the lowest median
  // log error; the two baselines are the global median alone and the raw
  // (unshrunk) category median alone.
  function backtest() {
    const catLogs = new Map();
    for (const c of comps) {
      const key = c.category ?? '(none)';
      if (!catLogs.has(key)) catLogs.set(key, []);
      catLogs.get(key).push(Math.log(c.ratio));
    }
    const totalLogSum = logRatios.reduce((a, b) => a + b, 0);
    const looGlobalMult = (skip) => {
      const rest = logRatios.filter((_, i) => i !== skip);
      return Math.exp(median(rest));
    };
    const run = (momW, mode) => {
      const errs = [], preds = [], actuals = [];
      comps.forEach((c, i) => {
        let mult;
        if (mode === 'global') mult = looGlobalMult(i);
        else {
          const logs = (catLogs.get(c.category ?? '(none)') ?? []).slice();
          const idx = comps.slice(0, i).filter((o) => o.category === c.category).length;
          logs.splice(idx, 1);
          mult = mode === 'rawcat'
            ? (logs.length ? Math.exp(median(logs)) : looGlobalMult(i))
            : shrunkMultiple(logs, Math.log(looGlobalMult(i)), K).mult;
        }
        mult = clamp(mult, bandLo, bandHi);
        const size = mode === 'full' ? Math.pow(c.tvl / compMedianTvl, -gamma) : 1;
        const excess = c.change_7d === null ? 0 : clamp(c.change_7d - marketMedian, excLo, excHi);
        const mom = mode === 'full' ? 1 + (momW * excess) / 100 : 1;
        const pred = c.tvl * mult * size * mom;
        errs.push(Math.abs(Math.log(pred / c.mcap)));
        preds.push(pred); actuals.push(c.mcap);
      });
      return {
        medianErr: median(errs),
        within2x: errs.filter((e) => e <= Math.LN2).length / errs.length,
        spearman: spearman(preds, actuals),
      };
    };
    const grid = [0, 0.5, 1].map((w) => ({ w, ...run(w, 'full') }));
    // The shipped configuration is the full model at the prior weight 0.5;
    // the grid is reported so a reader can see the weight is not fitted.
    const chosen = grid.find((g) => g.w === 0.5) ?? grid[0];
    return { chosen, grid, globalBaseline: run(0, 'global'), rawCatBaseline: run(0, 'rawcat') };
  }
  const bt = backtest();
  const momW = overrides.momW ?? 0.5;

  const rows = candidates.map((p) => scoreRow(p, momW));
  rows.sort((a, b) => b.implied - a.implied || b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const byTvl = [...rows].sort((a, b) => b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
  byTvl.forEach((r, i) => { r.tvlRank = i + 1; });
  for (const r of rows) r.rankDelta = r.tvlRank - r.rank;

  // Peers: nearest traded comps in the same category by log TVL distance.
  for (const r of rows) {
    r.peers = comps
      .filter((c) => c.category === r.category)
      .map((c) => ({ name: c.name, tvl: c.tvl, mcap: c.mcap, ratio: c.ratio, d: Math.abs(Math.log(c.tvl / r.tvl_usd)) }))
      .sort((a, b) => a.d - b.d || cmpSlug(a.name, b.name))
      .slice(0, 4)
      .map(({ name, tvl, mcap, ratio }) => ({ name, tvl, mcap, ratio }));
  }

  // Sensitivity: top-10 overlap when each fitted constant moves +-50%.
  const base10 = new Set(rows.slice(0, 10).map((r) => r.slug));
  const overlap = (list) => list.slice(0, 10).filter((r) => base10.has(r.slug)).length;
  let minOverlap = 10;
  for (const f2 of [
    { ...frame, K: K * 0.5 }, { ...frame, K: K * 1.5 },
    { ...frame, gamma: gamma * 0.5 }, { ...frame, gamma: Math.min(gamma * 1.5, 0.35) },
  ]) {
    const alt = candidates.map((p) => scoreRow(p, momW, f2));
    alt.sort((a, b) => b.implied - a.implied || b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
    minOverlap = Math.min(minOverlap, overlap(alt));
  }
  for (const w2 of [momW * 0.5, momW * 1.5]) {
    const alt = candidates.map((p) => scoreRow(p, w2));
    alt.sort((a, b) => b.implied - a.implied || b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
    minOverlap = Math.min(minOverlap, overlap(alt));
  }

  const meta = {
    asOf, total: protocols.length, tradedCount: comps.length, zeroMcap, signalNoMcap,
    cleanCount: clean.length, excluded, boardCount: rows.length,
    globalMult, bandLo, bandHi, beta, gamma, K, momW, marketMedian, excLo, excHi,
    medianAge: Math.round(medianAge), p90Age: Math.round(p90Age), compMedianTvl,
    categories, backtest: bt, sensitivityMinTop10: minOverlap,
    totalBoardTvl: rows.reduce((a, r) => a + r.tvl_usd, 0),
  };
  return { meta, rows, comps };
}

// ------------------------------------------------------------- farm plans
// A plan is composed, not templated from one string: category mechanics x
// cheapest listed chain x TVL tier x momentum state x age bucket. Every
// number in a step comes from the row's own snapshot fields, and the totals
// strip is summed from the quantities the steps quote, so they cannot disagree.

const fmtUsd = (v) => '$' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtPct = (v) => (v >= 0.1 ? v.toFixed(2) : v >= 0.001 ? v.toFixed(3) : v.toFixed(5));

const MECH = {
  'Dexs': {
    core: (r, c) => `Make real swaps on ${r.name}: trade ${c.size} of volume across at least 3 separate days, alternating pairs, and let each trade settle before the next. One-off wash-style loops in a single sitting are the pattern filters remove first.`,
    second: (r, c) => `Add one concentrated position in a stable or blue-chip pair sized near ${c.size.split('-')[0].trim()}, in a range you can actually maintain, and check it twice a week. Out of range it earns nothing and still counts as locked capital.`,
    txs: 10,
  },
  'Lending': {
    core: (r, c) => `Supply ${c.size} of a major asset on ${r.name} and leave it supplied. Passive deposits are the baseline signal every points program counts, and size held over time usually outweighs a larger deposit that leaves in a week.`,
    second: (r, c) => `Borrow a small amount against the position, about 20-30% of its value, hold it for a few days, then repay in full. Note the liquidation price the interface shows before borrowing and keep the health factor comfortably above it.`,
    txs: 6,
  },
  'CDP': {
    core: (r, c) => `Open a vault on ${r.name} with ${c.size} of collateral and mint a small amount of its stablecoin, roughly a quarter of the collateral value. A wide margin matters more than size: liquidation erases the whole history.`,
    second: (r, c) => `Use the minted stablecoin once inside the same ecosystem, then repay part of the debt and mint again a week later. Repeated mint and repay cycles show real usage of both sides of the product.`,
    txs: 6,
  },
  'Derivatives': {
    core: (r, c) => `Trade small perpetual positions on ${r.name}: open and close low-leverage trades (2-3x) across several funding intervals rather than one large trade. Volume spread over time and consistency are what these programs reward, not profit.`,
    second: (r, c) => `Keep a modest collateral balance, near ${c.size.split('-')[0].trim()}, parked between trades so the account reads as a returning trader, and vary the markets you trade instead of repeating one pair.`,
    txs: 12,
  },
  'RWA': {
    core: (r, c) => `Complete the onboarding and eligibility checks ${r.name} asks for first; real-world-asset platforms gate deposits behind them, and finishing early puts the wallet in the earliest cohort. Then deposit ${c.size} into its main vault or product.`,
    second: (r, c) => `Hold through at least one full yield or reporting cycle instead of exiting at the first opportunity. These products settle slowly, and a position that spans a cycle is the usage pattern that reads as genuine.`,
    txs: 4,
  },
  'Yield': {
    core: (r, c) => `Deposit ${c.size} into the main vault on ${r.name} and keep the receipt token in the same wallet. Moving or selling the receipt usually breaks the link between the wallet and the deposit history.`,
    second: (r, c) => `Stay through at least two epoch or rollover boundaries. Vault programs tend to snapshot at epoch ends, so a deposit that spans them is worth more than a larger one that leaves mid-epoch.`,
    txs: 4,
  },
  'Yield Aggregator': {
    core: (r, c) => `Deposit ${c.size} into one of ${r.name}'s main strategies and leave the position untouched through a full harvest cycle. Aggregators rebalance underneath; your signal is duration, not activity.`,
    second: (r, c) => `After the first cycle, add a second smaller deposit in a different strategy on the same platform. Breadth across strategies shows deliberate use rather than a single parked deposit.`,
    txs: 4,
  },
  'Basis Trading': {
    core: (r, c) => `Deposit ${c.size} of stablecoins into ${r.name}'s basis product and hold the position. The strategy runs delta-neutral underneath, so the wallet's job is simply to be present and stay.`,
    second: (r, c) => `Top the position up once after 3-4 weeks rather than depositing everything on day one. Two deposits at different times read as conviction and survive a single badly timed snapshot.`,
    txs: 3,
  },
  'Risk Curators': {
    core: (r, c) => `Deposit ${c.size} into one vault that ${r.name} curates on its host lending market. The curator's TVL here is managed inside that host, so pick the vault whose underlying market you would use anyway.`,
    second: (r, c) => `Split a second, smaller deposit across a different vault from the same curator. Curators are usually measured on total curated deposits per wallet, and two vaults show you compared their risk profiles.`,
    txs: 4,
  },
  'Onchain Capital Allocator': {
    core: (r, c) => `Deposit ${c.size} into ${r.name}'s main allocation vault. Allocator TVL is managed capital inside other protocols, so treat the position as a long hold and judge it over months, not weeks.`,
    second: (r, c) => `Revisit monthly and add small top-ups after allocation reports or strategy changes. Steady additions across several reports are the pattern of a real allocator user.`,
    txs: 3,
  },
  'Chain': {
    core: (r, c) => `Bridge ${c.size} onto ${r.name} through its canonical route and keep the funds on the chain. For a network, bridged capital that stays is the metric that matters most.`,
    second: (r, c) => `Use two or three native applications on the chain over the following weeks: a swap, a lending deposit, a transfer. A wallet with organic activity across the chain's own apps is the profile ecosystem programs look for.`,
    txs: 8,
  },
  'Prediction Market': {
    core: (r, c) => `Take small positions on ${r.name} across at least five different markets, sized near ${c.size.split('-')[0].trim()} each. Breadth across markets matters more than being right on any single one.`,
    second: (r, c) => `Let some positions settle and withdraw through the normal flow at least once. A wallet that has traded, settled and withdrawn has used the full product, not just its entry point.`,
    txs: 10,
  },
  'Restaking': {
    core: (r, c) => `Restake ${c.size} of a liquid staking token through ${r.name} and hold the receipt. Restaking programs count duration and the underlying asset, so start with the most widely accepted collateral.`,
    second: (r, c) => `If the platform supports more than one operator or strategy, split the position across two. Operator diversity is a stated goal of most restaking designs and is cheap to show.`,
    txs: 4,
  },
  'Farm': {
    core: (r, c) => `Provide ${c.size} of liquidity to ${r.name}'s main incentivized pool and stake the LP position where the platform asks. An unstaked LP position often earns nothing and may not be counted.`,
    second: (r, c) => `Harvest and restake rewards at least twice instead of letting them sit unclaimed. Repeated harvesting is on-chain proof of an active farmer rather than a forgotten deposit.`,
    txs: 8,
  },
};
const GENERIC = {
  core: (r, c) => `Use ${r.name}'s main product with ${c.size} of capital: complete its core action end to end (a deposit, position or trade, whichever the product is built around) and leave the result in place rather than reversing it the same day.`,
  second: (r, c) => `Repeat the core action a second time at least a week later, at a similar size. Two completed cycles on different dates are the simplest usage pattern that separates a real user from a one-visit wallet.`,
  txs: 5,
};

export function farmPlan(row, meta) {
  const cheap = cheapestChain(row.chains);
  const tier = row.tvl_usd >= 250e6 ? 'whale' : row.tvl_usd >= 25e6 ? 'mid' : 'early';
  const size = tier === 'whale' ? '$1,000-$2,500' : tier === 'mid' ? '$500-$2,000' : '$250-$500';
  const momState = row.excess === null ? 'flat' : row.excess > 5 ? 'accelerating' : row.excess < -5 ? 'draining' : 'flat';
  const ageBucket = row.ageDays === null ? 'established' : row.ageDays < 180 ? 'genesis' : row.ageDays <= 900 ? 'prime' : 'veteran';
  const weeks = ageBucket === 'genesis' ? 6 : ageBucket === 'veteran' ? 12 : 8;
  const mech = MECH[row.category] ?? GENERIC;
  const minDep = Math.max(10, Math.ceil((cheap.tier.mid * 40) / 10) * 10);
  const share = (1000 / row.tvl_usd) * 100;
  const ctx = { size };
  const steps = [];

  steps.push(`Open ${row.name} on ${cheap.chain}, the cheapest of its ${row.chains.length} listed chains (${cheap.tier.text}). Use a fresh wallet, run one minimum-size test transaction first, and approve exact amounts rather than unlimited approvals.`);
  steps.push(mech.core(row, ctx));
  steps.push(mech.second(row, ctx));
  if (row.chains.length >= 4) {
    const other = row.chains.find((c) => c !== cheap.chain) ?? cheap.chain;
    steps.push(`Breadth: ${row.name} runs on ${row.chains.length} chains. Once the main position is live on ${cheap.chain}, make one small transaction through ${other} as well. A two-chain footprint costs one extra transaction and is hard to build retroactively if a program later rewards it.`);
  }
  let flatNote = '';
  if (momState === 'accelerating')
    steps.push(`Momentum is working for this row: TVL moved ${row.change_7d.toFixed(1)}% in the snapshot week against a market median of ${meta.marketMedian.toFixed(1)}%, an excess of ${row.excess.toFixed(1)} points. Deposits are arriving faster than the market's, so enter in the first half of the plan: every week of delay dilutes a fixed deposit's share.`);
  else if (momState === 'draining')
    steps.push(`Momentum is against this row: TVL moved ${row.change_7d.toFixed(1)}% in the snapshot week against a market median of ${meta.marketMedian.toFixed(1)}%, an excess of ${row.excess.toFixed(1)} points. Before sizing up, check whether the drop tracks the market's prices or is real outflow, and start with half the planned size until the trend flattens.`);
  else
    flatNote = ` Momentum is unremarkable (${row.change_7d === null ? 'no 7-day figure in the snapshot' : row.change_7d.toFixed(1) + '% on the week'} against a ${meta.marketMedian.toFixed(1)}% market median), so timing is not the edge here; duration is.`;
  steps.push(`Keep gas under about 5% of the position: on ${cheap.chain} that means a sensible minimum deposit near ${fmtUsd(minDep)}. Below that, fees eat the point of farming; if your budget is smaller, wait for a cheaper window or skip this row.`);
  steps.push(`Size check: a $1,000 deposit is ${fmtPct(share)}% of ${row.name}'s ${fmtUsd(row.tvl_usd)} TVL. ${tier === 'early' ? 'At this size your share is still meaningful, which is exactly why early rows carry more smart-contract risk.' : tier === 'mid' ? 'That share is small, so consistency over the full plan matters more than adding size.' : 'At this scale a passive deposit is close to noise, so the plan leans on activity and duration rather than size.'}`);
  steps.push(`Repeat the core action on a weekly rhythm for about ${weeks} weeks, then check the protocol's points page, governance forum or announcement channel every two weeks. ${ageBucket === 'genesis' ? 'The protocol listed recently, so early epochs are the ones worth being present for.' : ageBucket === 'veteran' ? 'This protocol has run for years without a token, so an unbroken multi-month history is the strongest signal you can build.' : 'Most launch programs snapshot without warning; a steady history is what survives any snapshot date.'}${flatNote}`);
  if (ageBucket === 'prime' || ageBucket === 'veteran')
    steps.push(`When a token or snapshot is announced, stop adding size, keep the position untouched until the rules are published, and afterwards revoke the token approvals you granted. Revoking costs one more transaction of gas, and it closes the plan cleanly.`);

  const txs = 3 + mech.txs + weeks + (row.chains.length >= 4 ? 1 : 0);
  const gasUsd = Math.round(txs * cheap.tier.mid);
  const minutes = 25 + 10 * weeks;
  const why = `Why this plan: ${row.name} is a ${row.category ?? 'uncategorized'} protocol with ${fmtUsd(row.tvl_usd)} TVL (${tier} tier), ${momState} momentum and a ${ageBucket} age profile. It routes through ${cheap.chain} to keep gas near ${fmtUsd(cheap.tier.mid)} a transaction and sizes activity for duration over ${weeks} weeks.`;
  return { steps, totals: { txs, gasUsd, minutes, weeks }, why };
}
