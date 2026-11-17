// Token Launch Radar — board, watchlist, calibration set, method and one
// detail view per protocol, rendered from window.RADAR. Farm plans are
// composed live by model.js, the module the build runs, so the plan on this
// page is the plan in board.json, character for character.
import { farmPlan, cheapestChain, GAS_TIERS } from './model.js';

const R = window.RADAR, M = R.meta, rows = R.rows, comps = R.comps;
const watch = new Set(R.watchlist);
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const short = (n) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + (n / 1e3).toFixed(0) + 'K';
const fx = (n, d = 2) => n.toFixed(d);
const sgn = (n, d = 1) => (n > 0 ? '+' : '') + n.toFixed(d);
const planOf = new Map();
const plan = (r) => { if (!planOf.has(r.slug)) planOf.set(r.slug, farmPlan(r, M)); return planOf.get(r.slug); };
// One shared log scale for every range bar, so bars compare across rows.
const lgLo = Math.log(Math.min(...rows.map((r) => r.low))), lgHi = Math.log(Math.max(...rows.map((r) => r.high)));
const pos = (v) => Math.max(0, Math.min(100, (Math.log(v) - lgLo) / (lgHi - lgLo) * 100));
const rangeBar = (r) => `<div class="rangebar"><span style="position:absolute;left:${pos(r.low)}%;width:${Math.max(2, pos(r.high) - pos(r.low))}%;top:0;height:4px;background:#b9c6a9"></span><i style="left:${pos(r.implied)}%"></i></div>`;
const ageText = (r) => r.ageImputed ? 'age imputed' : `${r.ageDays} days tokenless`;

// ---------------------------------------------------------------- masthead
$('snapline').textContent = `Sealed snapshot / ${M.asOf}`;
$('maststats').innerHTML = [
  [`${watch.size} / ${watch.size}`, 'watchlist covered'],
  [short(M.totalBoardTvl), 'TVL on the radar'],
  [String(M.tradedCount), 'traded comparisons'],
].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
$('cnt-board').textContent = rows.length;
$('cnt-watch').textContent = watch.size;
$('cnt-traded').textContent = comps.length;
$('foot').textContent = `${M.asOf} · ${M.total} snapshot protocols · ${rows.length} ranked · board sha256:${M.boardHash} · Offline research.`;

// ------------------------------------------------------------------- board
const state = { q: '', cat: '', chain: '', min: 0, w: false, sort: 'rank', dir: 1 };
const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
$('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
$('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');

function boardRow(r) {
  const p = plan(r).totals, ch = cheapestChain(r.chains);
  const d = r.rankDelta;
  return `<tr>
    <td class="rank">${String(r.rank).padStart(2, '0')}</td>
    <td><a class="nm" href="#/p/${r.slug}">${esc(r.name)}</a>${watch.has(r.slug) ? ' <span class="star">&#9733;</span>' : ''}${r.managedTvl ? '<span class="flagtag">managed TVL</span>' : ''}<span class="sub">${esc(ch.chain)} &middot; ${p.txs} tx &middot; $${p.gasUsd} gas &middot; ${p.minutes} min</span></td>
    <td>${esc(r.category ?? 'Uncategorised')}<span class="sub">${ageText(r)}</span></td>
    <td class="num"><span class="big">${usd(r.tvl_usd)}</span></td>
    <td class="num">${r.excess == null ? '<span>&ndash;</span>' : `<span class="${r.excess >= 0 ? 'up' : 'down'}">${sgn(r.excess)} pp</span>`}<span class="sub">${r.changeMissing ? 'no 7d reading' : sgn(r.change_7d) + '% actual'}</span></td>
    <td class="num">${fx(r.mult, 3)}&times;<span class="sub">${r.compsN} traded comps</span></td>
    <td class="num shade"><span class="big">${usd(r.implied)}</span><span class="sub">${short(r.low)} &ndash; ${short(r.high)}</span>${rangeBar(r)}</td>
    <td class="num">${d === 0 ? '&ndash;' : `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '&#9650;' : '&#9660;'}${Math.abs(d)}</span>`}</td>
  </tr>`;
}
function renderBoard() {
  const list = rows.filter((r) =>
    (!state.q || (r.name + ' ' + r.slug).toLowerCase().includes(state.q)) &&
    (!state.cat || r.category === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    r.tvl_usd >= state.min && (!state.w || watch.has(r.slug)));
  const k = state.sort;
  const val = (r) => k === 'name' ? r.name : k === 'category' ? (r.category ?? '') : r[k];
  list.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? (x < y ? -1 : x > y ? 1 : 0) : x - y) * state.dir; });
  $('rows').innerHTML = list.map(boardRow).join('');
  $('count').textContent = `${list.length} of ${rows.length} protocols · sorted by ${k === 'rank' ? 'implied rank' : k}`;
  const ch = M.backtest.chosen;
  $('board-proof').innerHTML = `<b>${Math.round(ch.within2x * 100)}%</b> within 2&times; of market cap<a href="#/method">Leave-one-out test &middot; ${M.tradedCount} traded protocols &rarr;</a>`;
}
function syncHash() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q); if (state.cat) p.set('cat', state.cat);
  if (state.chain) p.set('chain', state.chain); if (state.min) p.set('min', state.min);
  if (state.w) p.set('w', '1'); if (state.sort !== 'rank') p.set('sort', state.sort);
  if (state.dir !== 1) p.set('dir', state.dir);
  const s = p.toString();
  history.replaceState(null, '', '#/' + (s ? '?' + s : ''));
}
const apply = () => { renderBoard(); syncHash(); };
$('q').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); apply(); });
$('cat').addEventListener('change', (e) => { state.cat = e.target.value; apply(); });
$('chain').addEventListener('change', (e) => { state.chain = e.target.value; apply(); });
$('minTvl').addEventListener('change', (e) => { state.min = +e.target.value; apply(); });
$('watchOnly').addEventListener('change', (e) => { state.w = e.target.checked; apply(); });
$('reset').addEventListener('click', () => {
  Object.assign(state, { q: '', cat: '', chain: '', min: 0, w: false, sort: 'rank', dir: 1 });
  $('q').value = ''; $('cat').value = ''; $('chain').value = ''; $('minTvl').value = '0'; $('watchOnly').checked = false; apply();
});
document.querySelectorAll('#board th').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.k;
  if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
  if (k === 'rank') state.dir = 1;
  apply();
}));

// --------------------------------------------------------------- watchlist
function renderWatch() {
  const list = rows.filter((r) => watch.has(r.slug));
  $('watch-count').innerHTML = `${list.length} / ${watch.size} covered &middot; ordered by implied value`;
  const ch = M.backtest.chosen, g = M.backtest.globalBaseline, c = M.backtest.rawCatBaseline;
  $('evidence').innerHTML = `
    <div class="ev"><h3>Tested against the traded set</h3><p>Leave-one-out &middot; ${M.tradedCount} protocols, each held out in turn. &plusmn;50% sensitivity keeps at least ${M.sensitivityMinTop10} of the top 10 in place.</p></div>
    <div class="ev"><b>${fx(Math.exp(ch.medianErr), 1)}&times;</b><span>model median error</span><p>Global ${fx(Math.exp(g.medianErr), 1)}&times; &middot; category ${fx(Math.exp(c.medianErr), 1)}&times;</p></div>
    <div class="ev"><b>${Math.round(ch.within2x * 100)}%</b><span>within 2&times; of market cap</span><p>Ranges cover multiple spread only.</p></div>
    <div class="ev"><b>${fx(ch.spearman, 2)}</b><span>rank correlation</span><p><a href="#/method">Full back-test &amp; assumptions &rarr;</a></p></div>`;
  $('tiles').innerHTML = list.map((r) => `<div class="tile">
    <div class="tr1"><span>#${r.rank}</span><span>${esc(r.category ?? '')}</span></div>
    <div class="tn"><a href="#/p/${r.slug}">${esc(r.name)}</a></div>
    <div><span class="tv">${short(r.implied)}</span><span class="tg">$${plan(r).totals.gasUsd} gas</span></div>
    ${rangeBar(r)}</div>`).join('');
}

// ----------------------------------------------------------------- traded
function renderTraded() {
  const catRows = Object.entries(M.categories).sort((a, b) => b[1].n - a[1].n).map(([name, c]) =>
    `<tr><td>${esc(name)}</td><td class="num">${c.n}</td><td class="num">${fx(c.rawMedian, 3)}&times;</td><td class="num">${fx(c.mult, 3)}&times;</td><td class="num">${Math.round(c.priorWeight * 100)}%</td></tr>`).join('');
  $('traded-body').innerHTML = `
    <p class="lede">These ${comps.length} protocols already trade; they are never ranked. The model learns each category's multiple from them, and the Methodology back-test is run on them. Protocols recording zero or negative market cap (${M.zeroMcap}) are dead or placeholder prices, excluded from calibration, as are ${M.signalNoMcap} token-signal products of traded parents.</p>
    <div class="tablewrap"><table class="plain"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead>
    <tbody>${comps.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.category ?? '')}</td><td class="num">${usd(c.tvl)}</td><td class="num">${usd(c.mcap)}</td><td class="num">${fx(c.ratio, 3)}&times;</td></tr>`).join('')}</tbody></table></div>
    <div class="method-sec"><h3>Category multiples, as fitted</h3>
    <div class="tablewrap"><table class="plain"><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Raw median</th><th class="num">Shrunk multiple</th><th class="num">Prior weight</th></tr></thead>
    <tbody>${catRows}</tbody></table></div></div>`;
}

// ----------------------------------------------------------------- method
function renderMethod() {
  const ch = M.backtest.chosen, g = M.backtest.globalBaseline, c = M.backtest.rawCatBaseline;
  const bt = (label, b) => `<tr><td>${label}</td><td class="num">${fx(Math.exp(b.medianErr), 1)}&times;</td><td class="num">${Math.round(b.within2x * 100)}%</td><td class="num">${fx(b.spearman, 2)}</td></tr>`;
  $('method-body').innerHTML = `
  <div class="method-sec"><h3>The formula</h3>
    <p><span class="mono">implied value = TVL &times; category multiple &times; size factor &times; momentum &times; maturity</span>, computed per protocol in <span class="mono">model.js</span>, the file this page loads. Nothing is ranked by hand; no protocol is named in the model.</p></div>
  <div class="method-sec"><h3>Category multiple</h3>
    <p>The median market-cap/TVL of the category's traded protocols, shrunk toward the global median (<b>${fx(M.globalMult, 3)}&times;</b>) in log space, shrinkage <span class="mono">K = ${M.K}</span>: a category with n comps keeps weight n/(n+K) on its own median, so thin categories lean on the market, not on one observation. Clamped to the traded band's 5th&ndash;95th percentiles, <b>${fx(M.bandLo, 3)}&times; to ${fx(M.bandHi, 1)}&times;</b>. Each row's range repeats the calculation at the category's shrunk interquartile bounds.</p></div>
  <div class="method-sec"><h3>Size factor</h3>
    <p>Market cap grows more slowly than TVL: a pooled log-log fit over the ${M.tradedCount} traded protocols gives elasticity <span class="mono">&beta; = ${fx(M.beta, 2)}</span>, so the factor is <span class="mono">(TVL / ${short(M.compMedianTvl)})^-&gamma;</span>, <span class="mono">&gamma; = ${fx(M.gamma, 2)}</span>, capped there because the uncapped fit overcorrects the largest rows in back-test.</p></div>
  <div class="method-sec"><h3>Momentum</h3>
    <p>Seven-day TVL change measured against the snapshot's own market: the median protocol fell <b>${fx(M.marketMedian, 1)}%</b> that week, so the factor prices the excess, winsorised to the traded excess band (${fx(M.excLo, 1)} to ${fx(M.excHi, 1)} points), weighted <span class="mono">${fx(M.momW, 1)}</span>. That weight is a disclosed prior, not a fit: the back-test grid cannot tell 0, 0.5 and 1 apart, so the middle value is used and stated, not hidden. A missing reading scores neutral and is flagged.</p></div>
  <div class="method-sec"><h3>Maturity</h3>
    <p>Running longer with no token counts, with diminishing returns: the factor rises concavely from 0.85 to 1.25, plateauing at the cohort's 90th-percentile age (<b>${M.p90Age} days</b>). No listing date means the median age (<b>${M.medianAge} days</b>) and an imputed flag, never silent treatment as new.</p></div>
  <div class="method-sec"><h3>Back-test: leave-one-out over the ${M.tradedCount} traded protocols</h3>
    <div class="tablewrap"><table class="plain"><thead><tr><th>Model</th><th class="num">Median error</th><th class="num">Within 2&times;</th><th class="num">Rank corr.</th></tr></thead>
    <tbody>${bt('Full model (this board)', ch)}${bt('Global median only', g)}${bt('Raw category median', c)}</tbody></table></div>
    <p>Read honestly: even the full model is typically off by a factor of ${fx(Math.exp(ch.medianErr), 1)}. This is a ranking instrument, not a price prediction; the ranges, not the point values, are the claim. Sensitivity: moving K, &gamma; and the momentum weight each by &plusmn;50% keeps at least ${M.sensitivityMinTop10} of the top 10 in place.</p></div>
  <div class="method-sec"><h3>Who is on the board</h3>
    <p>Of ${M.total} snapshot protocols, ${M.cleanCount} record no token at all. Excluded: ${M.excluded.category} in wrapper, bridge and exchange categories whose value belongs to a parent or a chain, and ${M.excluded.name} versioned or exchange-branded products, leaving <b>${M.boardCount} ranked</b>. All ${watch.size} watchlist protocols survive every filter; coverage is asserted at build time. Curator categories intermediate other protocols' capital; their rows are flagged <b>managed TVL</b> wherever they appear.</p></div>
  <div class="method-sec"><h3>Farm-plan gas assumptions</h3>
    <p>Planning assumptions, labelled as such — not snapshot data. Plans pick the cheapest of each protocol's own chains and size deposits so gas stays near 5% of position.</p>
    <div class="tablewrap"><table class="plain"><thead><tr><th>Tier</th><th class="num">Assumed gas / tx</th><th>Applies to</th></tr></thead>
    <tbody>${GAS_TIERS.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">$${t.mid}</td><td>${esc(t.text)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="method-sec"><h3>Limitations</h3>
    <p>One snapshot, one week of momentum, no off-chain information: team, audits, points programs and launch rumours are invisible to this model by design. Traded market caps are taken as recorded, stale ones included. Where snapshot and reality disagree, the snapshot wins: every entrant is judged on the same sealed data.</p></div>`;
}

// ----------------------------------------------------------------- detail
function renderDetail(r) {
  const p = plan(r), ch = cheapestChain(r.chains);
  const steps = [r.tvl_usd, r.tvl_usd * r.mult, 0, 0, r.implied];
  steps[2] = steps[1] * r.size; steps[3] = steps[2] * r.momentum;
  const wmax = r.tvl_usd;
  const wrow = (label, factor, v, fin) => `<div class="wrow${fin ? ' final' : ''}"><div class="wl"><b>${label}</b>${factor}</div><div class="wtrack"><div class="wfill" style="width:${Math.max(1.5, v / wmax * 100)}%"></div></div><div class="wv">${usd(v)}</div></div>`;
  const cat = M.categories[r.category] ?? null;
  const flags = [
    r.managedTvl ? '<b>Managed TVL:</b> this category intermediates other protocols\' capital, so TVL overstates its own footprint.<br>' : '',
    r.clamped ? 'Its category multiple sits at the edge of the traded band, so the band, not the category, sets it.<br>' : '',
    r.ageImputed ? 'No listing date is recorded; the cohort median age feeds the maturity factor.<br>' : '',
    r.changeMissing ? 'No 7-day change is recorded; momentum is neutral for this row.<br>' : '',
  ].join('');
  $('detail-body').innerHTML = `
    <a class="backlink" href="#/">&larr; Back to the radar</a>
    <div class="dtitle"><h2>${esc(r.name)}</h2>${watch.has(r.slug) ? '<span class="star">&#9733;</span>' : ''}
      <span class="chip">#${r.rank} of ${rows.length}</span><span class="chip">${esc(r.category ?? 'Uncategorised')}</span></div>
    <div class="statrow">
      <div class="stat"><b>${usd(r.implied)}</b><span>implied value &middot; ${short(r.low)}&ndash;${short(r.high)}</span></div>
      <div class="stat"><b>${short(r.tvl_usd)}</b><span>TVL &middot; #${r.tvlRank} by TVL</span></div>
      <div class="stat"><b>${fx(r.mult, 3)}&times;</b><span>multiple &middot; ${r.compsN} comps &middot; prior ${Math.round(r.priorWeight * 100)}%</span></div>
      <div class="stat"><b>${r.excess == null ? '&ndash;' : sgn(r.excess) + ' pp'}</b><span>7d vs market (${fx(M.marketMedian, 1)}%)</span></div>
      <div class="stat"><b>${r.ageDays} days</b><span>age without a token</span></div>
      <div class="stat"><b>${esc(ch.chain)}</b><span>cheapest of ${r.chains.length} chains</span></div>
    </div>
    <div class="dcols">
      <div class="dcol"><h3>How the value is built</h3>
        ${wrow('TVL', '', steps[0])}${wrow('Category multiple', '&times; ' + fx(r.mult, 3), steps[1])}${wrow('Size factor', '&times; ' + fx(r.size, 3), steps[2])}${wrow('Momentum', '&times; ' + fx(r.momentum, 3), steps[3])}${wrow('Maturity', '&times; ' + fx(r.maturity, 3), steps[4], true)}
        <p class="wnote">Linear scale from zero. ${cat ? `The multiple is the shrunk median of ${r.compsN} traded ${esc(r.category)} protocols (raw median ${fx(cat.rawMedian, 3)}&times;, prior weight ${Math.round(r.priorWeight * 100)}%).` : ''} The range spans the multiple's interquartile spread.</p>
        <div class="subsec"><h3>Nearest traded peers</h3>
        <table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap/TVL</th></tr></thead>
        <tbody>${r.peers.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${usd(x.tvl)}</td><td class="num">${usd(x.mcap)}</td><td class="num">${fx(x.ratio, 3)}&times;</td></tr>`).join('')}</tbody></table>
        <p class="wnote">Same category, nearest by log TVL distance.</p></div>
        <div class="subsec"><h3>Evidence &amp; flags</h3>
        <p class="evlist"><b>Chains:</b> ${r.chains.map(esc).join(', ')}.<br>${flags}Rank vs TVL rank: ${r.rankDelta >= 0 ? 'up' : 'down'} ${Math.abs(r.rankDelta)} places once size, momentum and maturity are priced in.</p></div>
      </div>
      <div class="planbox"><h3>The farm plan</h3>
        <p class="why">${esc(p.why)}</p>
        <div class="totals">
          <div class="t"><span>Transactions</span><b>${p.totals.txs}</b></div>
          <div class="t"><span>Est. gas</span><b>$${p.totals.gasUsd}</b></div>
          <div class="t"><span>Active time</span><b>${p.totals.minutes} min</b></div>
          <div class="t"><span>Horizon</span><b>${p.totals.weeks} weeks</b></div>
        </div>
        <ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ router
const views = { board: 'view-board', watchlist: 'view-watchlist', traded: 'view-traded', method: 'view-method', detail: 'view-detail' };
function route() {
  const hash = location.hash || '#/';
  const [path, qs] = hash.slice(2).split('?');
  const parts = path.split('/');
  let view = 'board', slug = null;
  if (parts[0] === 'watchlist') view = 'watchlist';
  else if (parts[0] === 'traded') view = 'traded';
  else if (parts[0] === 'method') view = 'method';
  else if (parts[0] === 'p' && parts[1]) { view = 'detail'; slug = parts[1]; }
  for (const [k, id] of Object.entries(views)) $(id).hidden = k !== view;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.nav === view));
  if (view === 'board') {
    if (qs) { const p = new URLSearchParams(qs);
      state.q = p.get('q') ?? ''; state.cat = p.get('cat') ?? ''; state.chain = p.get('chain') ?? '';
      state.min = +(p.get('min') ?? 0); state.w = p.get('w') === '1';
      state.sort = p.get('sort') ?? 'rank'; state.dir = +(p.get('dir') ?? 1);
      $('q').value = state.q; $('cat').value = state.cat; $('chain').value = state.chain;
      $('minTvl').value = String(state.min); $('watchOnly').checked = state.w; }
    renderBoard();
  }
  else if (view === 'watchlist') renderWatch();
  else if (view === 'traded') renderTraded();
  else if (view === 'method') renderMethod();
  else { const r = bySlug.get(slug); if (r) renderDetail(r); else location.hash = '#/'; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
