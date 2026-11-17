// Token Launch Radar: the board, the watchlist grid, the traded comps, the
// method, and one detail view per protocol. Everything renders from
// window.RADAR, the data file the build program writes from the sealed
// snapshot. The farm plans are composed live by model.js, the same file
// the build runs, so the plan on this page and the plan in board.json are
// one text, not two copies.

import { farmPlan, cheapestChain, GAS_TIERS } from './model.js';

const R = window.RADAR;
const M = R.meta;
const rows = R.rows;
const comps = R.comps;
const watch = new Set(R.watchlist);
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const commas = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const usd = (v) => '$' + commas(v);
const usdShort = (v) => (v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K' : usd(v));
const xf = (v) => v.toFixed(3) + 'x';
const signed = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);

// ------------------------------------------------------------ header/footer
document.getElementById('kpis').innerHTML = [
  [M.boardCount + '', 'still to come, ranked', false],
  ['40 / 40', 'watchlist covered', true],
  [M.tradedCount + '', 'traded comps calibrated', false],
  [usdShort(M.totalBoardTvl), 'TVL on the board', false],
  [M.asOf, 'snapshot date', false],
].map(([b, s, hot]) => `<div class="kpi${hot ? ' hot' : ''}"><b>${b}</b><span>${s}</span></div>`).join('');
document.getElementById('footer').textContent =
  `${M.total} snapshot protocols: ${M.tradedCount} traded comps, ${M.signalNoMcap} token-signal products of traded parents, ` +
  `${M.cleanCount} with no token recorded; ${M.excluded.category + M.excluded.name} excluded by the wrapper rule, ${M.boardCount} ranked. ` +
  `Board fingerprint sha256:${M.boardHash}. No network requests; this page renders offline.`;

// ------------------------------------------------------------------- board
const state = { sort: 'rank', dir: 1, q: '', cat: '', chain: '', min: 0, watchOnly: false };
const logMin = Math.log(Math.min(...rows.map((r) => r.low)));
const logMax = Math.log(Math.max(...rows.map((r) => r.high)));
const rangeGeom = (r) => {
  const l = ((Math.log(r.low) - logMin) / (logMax - logMin)) * 100;
  const w = Math.max(2, ((Math.log(r.high) - Math.log(r.low)) / (logMax - logMin)) * 100);
  const b = ((Math.log(r.implied) - logMin) / (logMax - logMin)) * 100;
  return { l, w, b };
};
const badges = (r) => {
  let s = '';
  if (watch.has(r.slug)) s += ' <span class="star" title="On the official watchlist">&#9733;</span>';
  if (r.managedTvl) s += '<span class="badge warn">managed TVL</span>';
  if (r.ageImputed) s += '<span class="badge soft">age imputed</span>';
  if (r.changeMissing) s += '<span class="badge soft">no 7d data</span>';
  if (r.clamped) s += '<span class="badge soft">band edge</span>';
  return s;
};
function boardRows() {
  let out = rows.filter((r) =>
    (state.cat === '' || r.category === state.cat) &&
    (state.chain === '' || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.min &&
    (!state.watchOnly || watch.has(r.slug)) &&
    (state.q === '' || r.name.toLowerCase().includes(state.q)));
  const key = state.sort, dir = state.dir;
  out = [...out].sort((a, b) => {
    const va = key === 'excess' ? (a.excess ?? -1e9) : a[key];
    const vb = key === 'excess' ? (b.excess ?? -1e9) : b[key];
    if (typeof va === 'string') return dir * (va < vb ? -1 : va > vb ? 1 : 0);
    return dir * (va - vb);
  });
  return out;
}
function renderBoard() {
  const list = boardRows();
  document.getElementById('showing').textContent =
    `Showing ${list.length} of ${rows.length} protocols · sorted by ${state.sort}${state.watchOnly ? ' · watchlist only' : ''}`;
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    const on = th.dataset.sort === state.sort;
    th.innerHTML = th.textContent.replace(/ [▲▼]$/, '') + (on ? ` <span class="dir">${state.dir === 1 ? '▲' : '▼'}</span>` : '');
  });
  document.getElementById('board-body').innerHTML = list.map((r) => {
    const g = rangeGeom(r);
    const cheap = cheapestChain(r.chains);
    const delta = r.rankDelta === 0 ? '<span style="color:var(--faint)">-</span>'
      : r.rankDelta > 0 ? `<span class="pos">&#9650;${r.rankDelta}</span>` : `<span class="neg">&#9660;${-r.rankDelta}</span>`;
    return `<tr data-slug="${r.slug}">
      <td class="num">${r.rank}</td>
      <td><a class="pname" href="#/p/${r.slug}">${esc(r.name)}</a>${badges(r)}<br><span style="color:var(--faint);font-size:12px">${r.chains.length} chains · cheapest ${esc(cheap.chain)}</span></td>
      <td>${esc(r.category ?? '—')}</td>
      <td class="num">${usd(r.tvl_usd)}</td>
      <td class="num">${r.excess === null ? '<span style="color:var(--faint)">no data</span>' : `<span class="${r.excess >= 0 ? 'pos' : 'neg'}">${signed(r.excess)}%</span>`}</td>
      <td class="num">${xf(r.mult)}</td>
      <td class="num"><b>${usd(r.implied)}</b><br><span style="color:var(--faint);font-size:12px">${usdShort(r.low)} – ${usdShort(r.high)}</span><div class="rangebar"><i style="left:${g.l}%;width:${g.w}%"></i><b style="left:${g.b}%"></b></div></td>
      <td class="num">${delta}</td>
    </tr>`;
  }).join('');
}
function syncFilterHash() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('cat', state.cat);
  if (state.chain) p.set('chain', state.chain);
  if (state.min) p.set('min', String(state.min));
  if (state.watchOnly) p.set('w', '1');
  const s = p.toString();
  history.replaceState(null, '', '#/' + (s ? '?' + s : ''));
}

// -------------------------------------------------------------- watchlist
function renderWatchlist() {
  const list = rows.filter((r) => watch.has(r.slug));
  document.getElementById('tiles').innerHTML = list.map((r) => {
    const g = rangeGeom(r);
    return `<div class="tile"><span class="r">#${r.rank}</span> <span class="c">${esc(r.category ?? '')}</span>
      <div class="n"><a href="#/p/${r.slug}">${esc(r.name)}</a></div>
      <span class="v">${usd(r.implied)}</span>
      <div class="rangebar"><i style="left:${g.l}%;width:${g.w}%"></i><b style="left:${g.b}%"></b></div></div>`;
  }).join('');
  const bt = M.backtest, ch = bt.chosen;
  document.getElementById('evidence').innerHTML = `<h3>Evidence, not assertion</h3>
    <p>Every watchlist protocol above is on the board: <span class="mono">40 / 40 covered</span>, coverage asserted at build time.</p>
    <p>Leave-one-out back-test over the ${M.tradedCount} traded protocols (each predicted from a model fitted without it):
    the full model lands a median error of <span class="mono">${Math.exp(ch.medianErr).toFixed(1)}x</span> and
    <span class="mono">${Math.round(ch.within2x * 100)}%</span> of protocols within 2x of their actual market cap
    (rank correlation <span class="mono">${ch.spearman.toFixed(2)}</span>). The global-median baseline errs
    <span class="mono">${Math.exp(bt.globalBaseline.medianErr).toFixed(1)}x</span>; the raw category median
    <span class="mono">${Math.exp(bt.rawCatBaseline.medianErr).toFixed(1)}x</span>.</p>
    <p>Sensitivity: moving each fitted constant (shrinkage, size elasticity, momentum weight) by &plusmn;50% keeps at least
    <span class="mono">${M.sensitivityMinTop10} of the top 10</span> in place.</p>`;
}

// ----------------------------------------------------------------- traded
let csort = { key: 'mcap', dir: -1 };
function renderTraded() {
  document.getElementById('traded-note').textContent =
    `These ${comps.length} protocols already trade; they are never ranked. The model learns each category's multiple from them, ` +
    `and the back-test under Method is run on them. Protocols recording a zero or negative market cap are dead or placeholder prices: ` +
    `they calibrate nothing and are not ranked either.`;
  const list = [...comps].sort((a, b) => {
    const va = a[csort.key], vb = b[csort.key];
    if (typeof va === 'string') return csort.dir * (va < vb ? -1 : va > vb ? 1 : 0);
    return csort.dir * (va - vb);
  });
  document.getElementById('comp-body').innerHTML = list.map((c) =>
    `<tr><td class="pname">${esc(c.name)}</td><td>${esc(c.category ?? '—')}</td><td class="num">${usd(c.tvl)}</td><td class="num">${usd(c.mcap)}</td><td class="num">${xf(c.ratio)}</td></tr>`).join('');
  const cats = Object.entries(M.categories).sort((a, b) => b[1].n - a[1].n);
  document.getElementById('cat-body').innerHTML = cats.map(([name, c]) =>
    `<tr><td>${esc(name)}</td><td class="num">${c.n}</td><td class="num">${xf(c.rawMedian)}</td><td class="num"><b>${xf(c.mult)}</b></td><td class="num">${Math.round(c.priorWeight * 100)}%</td></tr>`).join('');
}

// ----------------------------------------------------------------- method
function renderMethod() {
  const bt = M.backtest, ch = bt.chosen;
  const err = (e) => Math.exp(e).toFixed(1) + 'x';
  const gridLine = bt.grid.map((g) => `weight ${g.w}: ${err(g.medianErr)}`).join(' · ');
  document.getElementById('method-body').innerHTML = `
  <div class="method-sec"><h3>The model</h3>
    <p><span class="mono">implied = TVL x category multiple x size factor x momentum x maturity</span>, computed in
    <span class="mono">model.js</span>, which this page loads and the build program runs; one implementation, not two.</p>
    <p><b>Category multiple.</b> The median market-cap/TVL of the category's traded protocols, shrunk toward the global median
    (<span class="mono">${xf(M.globalMult)}</span>) in log space, weight n/(n+${M.K}): one comp is mostly prior, fifteen is mostly
    its own data. Clamped to the traded ratios' 5th-95th percentile band (<span class="mono">${M.bandLo.toFixed(3)} – ${M.bandHi.toFixed(2)}</span>).</p>
    <p><b>Size factor.</b> Market cap grows slower than TVL: the pooled log-log fit gives elasticity
    <span class="mono">&beta; = ${M.beta.toFixed(2)}</span>, so the multiple scales by (TVL / median traded TVL)<sup>-${M.gamma.toFixed(2)}</sup>,
    the fitted exponent capped at 0.35.</p>
    <p><b>Momentum.</b> The 7-day TVL change minus the snapshot-wide median (<span class="mono">${M.marketMedian.toFixed(1)}%</span>:
    the market fell that week, so flat outperformed), winsorized to its 5th-95th percentiles, weighted 0.5.</p>
    <p><b>Maturity.</b> A concave curve in age since listing, 0.85x when new rising to 1.25x at the cohort's 90th-percentile age
    (<span class="mono">${commas(M.p90Age)} days</span>; median <span class="mono">${commas(M.medianAge)} days</span>). A missing date is imputed to the median and flagged.</p></div>
  <div class="method-sec"><h3>Back-test: leave-one-out over the ${M.tradedCount} traded protocols</h3>
    <table><thead><tr><th>Model</th><th class="num">Median error</th><th class="num">Within 2x</th><th class="num">Rank correlation</th></tr></thead>
    <tbody>
      <tr><td><b>Full model (as shipped)</b></td><td class="num">${err(ch.medianErr)}</td><td class="num">${Math.round(ch.within2x * 100)}%</td><td class="num">${ch.spearman.toFixed(2)}</td></tr>
      <tr><td>Global median only</td><td class="num">${err(bt.globalBaseline.medianErr)}</td><td class="num">${Math.round(bt.globalBaseline.within2x * 100)}%</td><td class="num">${bt.globalBaseline.spearman.toFixed(2)}</td></tr>
      <tr><td>Raw category median only</td><td class="num">${err(bt.rawCatBaseline.medianErr)}</td><td class="num">${Math.round(bt.rawCatBaseline.within2x * 100)}%</td><td class="num">${bt.rawCatBaseline.spearman.toFixed(2)}</td></tr>
    </tbody></table>
    <p>Momentum weights in the same test (${gridLine}) differ by less than 2%, so the 0.5 weight is a bounded prior, not a fit.
    Maturity cannot be back-tested from a snapshot at all; it is likewise a bounded prior, disclosed rather than fitted.
    Sensitivity: at &plusmn;50% on each fitted constant, at least ${M.sensitivityMinTop10} of the board's top 10 stay in place.</p></div>
  <div class="method-sec"><h3>How the board is built</h3>
    <p>Of ${M.total} snapshot protocols, ${M.cleanCount} record no token at all (no market cap, no symbol, no gecko id).
    ${M.signalNoMcap} carry a traded parent's symbol without a price of their own (aave-v3 carries AAVE) and are never ranked.
    The board then applies the watchlist's own exclusion rule: ${M.excluded.category} rows in wrapper or venue categories
    (CEX, bridges, liquid staking and restaking) and ${M.excluded.name} name-marked wrapped, staked, versioned or
    exchange-branded products, leaving <span class="mono">${M.boardCount} ranked</span>. All 40 watchlist protocols survive
    the rule; the build asserts their coverage and fails if one is missing.</p></div>
  <div class="method-sec"><h3>Farm plans and the gas assumptions</h3>
    <p>Each plan is composed in model.js from category mechanics, cheapest listed chain, TVL tier, momentum state and age
    bucket; the totals are summed from the quantities the steps quote. Gas figures are planning tiers, not snapshot data:</p>
    <table><thead><tr><th>Tier</th><th>Planning figure</th></tr></thead><tbody>
    ${GAS_TIERS.map((t) => `<tr><td>${esc(t.label)}</td><td>${esc(t.text)}</td></tr>`).join('')}
    </tbody></table></div>
  <div class="method-sec"><h3>Limitations</h3>
    <ul>
      <li>Value ranges span the category multiple's interquartile spread only; they are not confidence intervals for a launch price.</li>
      <li>Curator and allocator TVL is managed inside host protocols, so those rows can double-count capital; they are flagged "managed TVL".</li>
      <li>A protocol can be tokenless by design (a venue, a public good). The model prices the launch it could do, not the one it promises.</li>
      <li>One week of TVL change is a weak signal; momentum is deliberately the smallest lever in the formula.</li>
    </ul></div>`;
}

// ----------------------------------------------------------------- detail
function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) { location.hash = '#/'; return; }
  const plan = farmPlan(r, M);
  const cheap = cheapestChain(r.chains);
  const stages = [
    ['TVL', 1, r.tvl_usd],
    ['x category multiple', r.mult, r.tvl_usd * r.mult],
    ['x size factor', r.size, r.tvl_usd * r.mult * r.size],
    ['x momentum', r.momentum, r.tvl_usd * r.mult * r.size * r.momentum],
    ['x maturity', r.maturity, r.implied],
  ];
  const vals = stages.map((s) => s[2]);
  const lo = Math.log(Math.min(...vals) * 0.92), hi = Math.log(Math.max(...vals));
  const width = (v) => Math.max(3, ((Math.log(v) - lo) / (hi - lo)) * 100).toFixed(1);
  const cat = M.categories[r.category] ?? null;
  document.getElementById('detail-body').innerHTML = `
    <div class="dhead"><h2>${esc(r.name)}</h2>${badges(r)}
      <span class="badge soft">rank #${r.rank} of ${rows.length}</span>
      <span class="badge soft">${esc(r.category ?? 'uncategorized')}</span></div>
    <div class="statcards">
      <div class="kpi hot"><b>${usd(r.implied)}</b><span>implied value · range ${usdShort(r.low)} – ${usdShort(r.high)}</span></div>
      <div class="kpi"><b>${usd(r.tvl_usd)}</b><span>TVL · #${r.tvlRank} by TVL</span></div>
      <div class="kpi"><b>${xf(r.mult)}</b><span>multiple · ${r.compsN} comps · prior ${Math.round(r.priorWeight * 100)}%</span></div>
      <div class="kpi"><b>${r.excess === null ? 'no data' : signed(r.excess) + '%'}</b><span>7d vs market (${signed(M.marketMedian)}%)</span></div>
      <div class="kpi"><b>${r.ageDays === null ? 'imputed' : commas(r.ageDays) + ' d'}</b><span>listed age${r.ageImputed ? ' · median used' : ''}</span></div>
      <div class="kpi"><b>${esc(cheap.chain)}</b><span>cheapest of ${r.chains.length} chains</span></div>
    </div>
    <div class="waterfall"><h3>How the value is built</h3>
      ${stages.map(([label, fac, v], i) => `<div class="wrow${i === stages.length - 1 ? ' final' : ''}">
        <span>${label}${i > 0 ? ` <span class="fac">${fac.toFixed(3)}</span>` : ''}</span>
        <span class="bar"><i style="width:${width(v)}%"></i></span>
        <span class="amt">${usd(v)}</span></div>`).join('')}
      <p class="note">The multiple is the shrunk median of ${r.compsN} traded ${esc(r.category ?? '')} protocols
      ${cat ? `(raw median ${xf(cat.rawMedian)}, prior weight ${Math.round(cat.priorWeight * 100)}%)` : '(no traded comps: the global median speaks)'}.
      The range ${usdShort(r.low)} – ${usdShort(r.high)} spans that category's interquartile spread.</p>
    </div>
    <div class="planbox"><h3>The farm plan</h3>
      <p class="why">${esc(plan.why)}</p>
      <div class="totals">
        <div class="t"><span>transactions</span>${plan.totals.txs}</div>
        <div class="t"><span>est. gas</span>${usd(plan.totals.gasUsd)}</div>
        <div class="t"><span>active time</span>${plan.totals.minutes} min</div>
        <div class="t"><span>horizon</span>${plan.totals.weeks} weeks</div>
      </div>
      <ol class="steps">${plan.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>
    <div class="cols">
      <div class="waterfall"><h3>Nearest traded peers in ${esc(r.category ?? 'its category')}</h3>
        ${r.peers.length ? `<table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap/TVL</th></tr></thead>
        <tbody>${r.peers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${usd(p.tvl)}</td><td class="num">${usd(p.mcap)}</td><td class="num">${xf(p.ratio)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="note">No traded protocol shares this category, so the global median multiple applies.</p>'}
      </div>
      <div class="waterfall"><h3>Evidence on this row</h3>
        <p class="note">Chains: ${r.chains.map(esc).join(', ')}.<br>
        ${r.managedTvl ? 'This is a curator or allocator: its TVL is managed inside host protocols and can double-count their capital. Read the value conservatively.<br>' : ''}
        ${r.clamped ? 'Its category multiple sits at the edge of the traded band, so the band, not the category, sets it.<br>' : ''}
        ${r.ageImputed ? 'No listing date is recorded; the cohort median age feeds the maturity factor.<br>' : ''}
        ${r.changeMissing ? 'No 7-day change is recorded; momentum is neutral for this row.<br>' : ''}
        Rank vs TVL rank: ${r.rankDelta >= 0 ? 'up' : 'down'} ${Math.abs(r.rankDelta)} places once size, momentum and maturity are priced in.</p>
      </div>
    </div>`;
}

// ----------------------------------------------------------------- router
const views = { board: 'view-board', watchlist: 'view-watchlist', traded: 'view-traded', method: 'view-method', detail: 'view-detail' };
function route() {
  const hash = location.hash || '#/';
  const [path, qs] = hash.slice(1).split('?');
  let view = 'board';
  if (path === '/watchlist') view = 'watchlist';
  else if (path === '/traded') view = 'traded';
  else if (path === '/method') view = 'method';
  else if (path.startsWith('/p/')) view = 'detail';
  for (const [k, id] of Object.entries(views)) document.getElementById(id).hidden = k !== view;
  document.body.classList.toggle('slim', view === 'detail');
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.nav === view));
  if (view === 'board') {
    if (qs) {
      const p = new URLSearchParams(qs);
      state.q = p.get('q') ?? ''; state.cat = p.get('cat') ?? ''; state.chain = p.get('chain') ?? '';
      state.min = Number(p.get('min') ?? 0); state.watchOnly = p.get('w') === '1';
      document.getElementById('f-q').value = state.q;
      document.getElementById('f-cat').value = state.cat;
      document.getElementById('f-chain').value = state.chain;
      document.getElementById('f-tvl').value = String(state.min);
      document.getElementById('f-watch').checked = state.watchOnly;
    }
    renderBoard();
  } else if (view === 'watchlist') renderWatchlist();
  else if (view === 'traded') renderTraded();
  else if (view === 'method') renderMethod();
  else renderDetail(path.slice(3));
  window.scrollTo(0, 0);
}

// filter + sort wiring
{
  const catSel = document.getElementById('f-cat');
  catSel.innerHTML = '<option value="">all categories</option>' + [...new Set(rows.map((r) => r.category).filter(Boolean))].sort().map((c) => `<option>${esc(c)}</option>`).join('');
  const chainSel = document.getElementById('f-chain');
  chainSel.innerHTML = '<option value="">all chains</option>' + [...new Set(rows.flatMap((r) => r.chains))].sort().map((c) => `<option>${esc(c)}</option>`).join('');
  const upd = () => {
    state.q = document.getElementById('f-q').value.trim().toLowerCase();
    state.cat = catSel.value; state.chain = chainSel.value;
    state.min = Number(document.getElementById('f-tvl').value);
    state.watchOnly = document.getElementById('f-watch').checked;
    syncFilterHash(); renderBoard();
  };
  for (const id of ['f-q', 'f-cat', 'f-chain', 'f-tvl', 'f-watch'])
    document.getElementById(id).addEventListener('input', upd);
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      renderBoard();
    }));
  document.querySelectorAll('#comp-table th[data-csort]').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.csort;
      if (csort.key === k) csort.dir *= -1; else csort = { key: k, dir: k === 'name' || k === 'category' ? 1 : -1 };
      renderTraded();
    }));
}
window.addEventListener('hashchange', route);
route();
