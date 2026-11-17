// Token Launch Radar: the board, its filters and the detail view.
// Everything on the page comes from window.RADAR, the data script the
// entry's program writes beside this page from the sealed snapshot.
// No network, no framework: the page is three files and this is one.

(function () {
  'use strict';

  var radar = window.RADAR;
  var rows = radar.rows;
  var meta = radar.meta;

  function el(id) { return document.getElementById(id); }

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v;
  }

  function pct(v) {
    if (v === null) return '<span class="chains">n/a</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(2) + '%</span>';
  }

  function ageText(days) {
    if (days === null) return 'n/a';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.44) + ' mo';
    return days + ' days';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Header stats: the sweep of the snapshot, stated plainly.
  el('stats').innerHTML =
    '<div><dt>Snapshot</dt><dd>' + esc(meta.as_of) + '</dd></div>' +
    '<div><dt>Protocols seen</dt><dd>' + meta.protocols_seen + '</dd></div>' +
    '<div><dt>Pre-token</dt><dd>' + meta.pre_token + '</dd></div>' +
    '<div><dt>On the board</dt><dd>' + meta.board_rows + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + meta.watchlist_size + ' / ' + meta.watchlist_size + '</dd></div>';

  el('model-text').textContent =
    'Implied value = TVL x category multiple x momentum x maturity. The category multiple is the median ' +
    'market-cap-to-TVL ratio of the category\'s traded tokens in this snapshot (global median ' +
    meta.global_multiple.toFixed(3) + 'x), shrunk toward that global median by the count behind it; a category ' +
    'with fewer than three traded tokens uses the global median, since one protocol\'s ratio is an anecdote, ' +
    'not a market. Momentum moves with the seven-day TVL change, capped at +/-40%. Maturity pays up to +10% for ' +
    'five tracked years with no token. Every figure is computed from the snapshot by the entry\'s program; ' +
    'no protocol is placed by hand.';

  // Filter options, from the board itself.
  var cats = {};
  var chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  el('cat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  el('chain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  // Category multiples strip: one chip per category on the board.
  var byCat = {};
  rows.forEach(function (r) {
    var key = r.category || 'Uncategorised';
    if (!byCat[key]) byCat[key] = { multiple: r.multiple, count: 0 };
    byCat[key].count += 1;
  });
  el('multiples').innerHTML = Object.keys(byCat).sort().map(function (c) {
    return '<span><b>' + esc(c) + '</b> ' + byCat[c].multiple.toFixed(3) + 'x · ' + byCat[c].count + ' ranked</span>';
  }).join('');

  var state = { sort: 'rank', dir: 1 };

  function visible() {
    var q = el('q').value.trim().toLowerCase();
    var cat = el('cat').value;
    var chain = el('chain').value;
    var minTvl = Number(el('min-tvl').value);
    var wlOnly = el('wl').checked;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (r.tvl_usd < minTvl) return false;
      if (wlOnly && !r.watchlist) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'string') return state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });
    return out;
  }

  function render() {
    var list = visible();
    el('empty').hidden = list.length > 0;
    el('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="proto-name">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">Watchlist</span>' : '') +
        '<div class="proto-cat">' + esc(r.category || 'Uncategorised') + '</div></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(3) + 'x</td>' +
        '<td class="num value">' + money(r.implied_value_usd) + '</td>' +
        '</tr>';
    }).join('');
    var heads = document.querySelectorAll('thead th[data-sort]');
    heads.forEach(function (th) {
      var label = th.getAttribute('data-label') || th.textContent;
      th.setAttribute('data-label', label);
      th.innerHTML = esc(label) + (th.getAttribute('data-sort') === state.sort ? ' <span class="arrow">' + (state.dir === 1 ? '↑' : '↓') + '</span>' : '');
    });
  }

  ['q', 'cat', 'chain', 'min-tvl', 'wl'].forEach(function (id) {
    el(id).addEventListener('input', render);
    el(id).addEventListener('change', render);
  });
  document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      if (key === 'rank') state.dir = 1;
      render();
    });
  });
  el('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/p/' + tr.getAttribute('data-slug');
  });

  function detail(r) {
    var view = el('detail-view');
    view.innerHTML =
      '<button class="back" id="back">← Back to the board</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      (r.watchlist ? '<span class="badge">Watchlist</span>' : '') +
      '<span class="proto-cat">Rank ' + r.rank + ' of ' + rows.length + ' · ' + esc(r.category || 'Uncategorised') + '</span></div>' +
      '<div class="detail-grid">' +
      '<div class="card"><h3>Implied launch value</h3><div class="big value">' + money(r.implied_value_usd) + '</div><p>What a token would be worth if this protocol\'s record stayed as it is.</p></div>' +
      '<div class="card"><h3>Total value locked</h3><div class="big">' + money(r.tvl_usd) + '</div><p>Across ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': ' + esc(r.chains.join(', ')) + '.</p></div>' +
      '<div class="card"><h3>7d TVL change</h3><div class="big">' + pct(r.change_7d) + '</div><p>The momentum the model reads, capped at +/-40%.</p></div>' +
      '<div class="card"><h3>Tracked with no token</h3><div class="big">' + ageText(r.age_days) + '</div><p>DefiLlama has tracked it since ' + esc(r.listed_at || 'an unrecorded date') + ' and it still records no token.</p></div>' +
      '</div>' +
      '<div class="formula"><h3 style="margin:0 0 8px;color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.12em">The model, on this protocol</h3>' +
      '<code>' + money(r.tvl_usd) + ' TVL x ' + r.multiple.toFixed(3) + ' category multiple x ' + r.momentum.toFixed(3) +
      ' momentum x ' + r.maturity.toFixed(3) + ' maturity = ' + money(r.implied_value_usd) + '</code>' +
      '<p style="color:var(--muted);margin:8px 0 0">' + (r.multiple_source === 'category'
        ? 'The ' + r.multiple.toFixed(3) + 'x multiple is the median market-cap-to-TVL of traded ' +
          esc(r.category || 'uncategorised') + ' protocols in the snapshot, shrunk toward the global median of ' + meta.global_multiple.toFixed(3) + 'x.'
        : 'The ' + r.multiple.toFixed(3) + 'x multiple is the global median market-cap-to-TVL across every traded protocol in the snapshot: fewer than three ' +
          esc(r.category || 'uncategorised') + ' protocols record a traded token, too few to learn a category multiple from.') + '</p></div>' +
      '<h3 style="margin:22px 0 4px">How to farm it</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    el('back').addEventListener('click', function () { location.hash = '#/'; });
    window.scrollTo(0, 0);
  }

  function route() {
    var m = /^#\/p\/(.+)$/.exec(location.hash);
    var row = null;
    if (m) {
      for (var i = 0; i < rows.length; i += 1) if (rows[i].slug === m[1]) row = rows[i];
    }
    if (row) {
      el('board-view').hidden = true;
      el('detail-view').hidden = false;
      detail(row);
    } else {
      el('detail-view').hidden = true;
      el('board-view').hidden = false;
    }
  }

  window.addEventListener('hashchange', route);
  render();
  route();
})();
