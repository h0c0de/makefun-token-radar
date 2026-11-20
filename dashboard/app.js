/* Token Launch Radar — the page. Renders window.RADAR (written by main.ts beside this
   folder as ../data.js): a sortable, filterable board of pre-token protocols ranked by
   implied launch value with a value range and a farm verdict per row, a detail view per
   protocol showing the model's arithmetic and its live comparables, the full published
   list of protocols set aside with their reasons, a live-token view kept apart from the
   ranking, and the methodology with the model's own leave-one-out backtest. No network,
   no framework, nothing recomputed: every number is written by the program. */
(function () {
  'use strict';
  var D = window.RADAR;
  var boardEl = document.getElementById('board');
  var mast = document.getElementById('masthead');
  var dialog = document.getElementById('detail');
  if (!D) { boardEl.textContent = 'No radar data: run main.ts first.'; return; }

  var state = { tab: 'board', q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'rank', dir: 1 };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function usd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function usdFull(n) { return n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 60) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + ' mo';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function mult(n) { return '×' + n.toFixed(n < 0.1 ? 3 : 2); }
  function isBorderline(r) { return r.notes.some(function (s) { return s.indexOf('Borderline:') === 0; }); }

  /* ---------- masthead: the whole story above the fold ---------- */
  function stat(n, label, cls) {
    return el('div', { class: 'stat' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'n', text: String(n) }),
      el('span', { class: 'l', text: label }),
    ]);
  }
  function story(big, small) {
    return el('div', { class: 'story-cell' }, [
      el('span', { class: 'big', text: big }),
      el('span', { class: 'small', text: small }),
    ]);
  }
  var bt = D.backtest;
  var topAside = D.exclusions.slice(0, 3).map(function (e) { return e.name; }).join(', ');
  mast.appendChild(el('p', { class: 'kicker', text: 'Token launch radar · sealed DefiLlama snapshot · ' + D.as_of }));
  mast.appendChild(el('h1', null, [
    document.createTextNode('Protocols that have not launched a token, '),
    el('span', { class: 'thin', text: 'ranked by what a launch could be worth.' }),
  ]));
  mast.appendChild(el('div', { class: 'story' }, [
    story(D.counts.board + ' ranked', D.counts.protocols + ' protocols screened · ' + D.counts.pre_token + ' record no token · house watchlist covered ' + D.counts.watchlist + ' / ' + D.counts.watchlist),
    story(D.counts.products_set_aside + ' set aside, with reasons', 'The largest are ' + topAside + ' — exchange listings and wrapped products, not launches. The full list is published under “Set aside”.'),
    story('TVL × peer multiple', 'Each category is priced from its own live-token comparables in this snapshot, shrunk toward a size curve — big protocols earn smaller multiples — then adjusted for 7-day growth and no-token age.'),
    story(bt.blended_median_fold.toFixed(2) + '× median error', 'Leave-one-out backtest on the snapshot\u2019s ' + bt.fit_protocols + ' live tokens. Category medians alone: ' + bt.category_median_fold.toFixed(2) + '×. So every value below is a range, not a point.'),
  ]));
  mast.appendChild(el('div', { class: 'stats' }, [
    stat(D.counts.protocols, 'protocols scanned'),
    stat(D.counts.pre_token, 'record no token'),
    stat(D.counts.board, 'ranked on the board', 'hot'),
    stat(D.counts.watchlist + ' / ' + D.counts.watchlist, 'watchlist covered', 'warn'),
    stat(D.counts.early, 'early finds below the floor'),
    stat(D.counts.borderline, 'flagged borderline'),
    stat(D.counts.products_set_aside, 'products set aside'),
  ]));

  /* ---------- controls ---------- */
  var categories = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
  var chains = Array.from(new Set(D.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
  var search = el('input', { type: 'search', placeholder: 'Search name or slug…', 'aria-label': 'Search protocols' });
  search.addEventListener('input', function () { state.q = search.value.trim().toLowerCase(); render(); });
  var catSel = el('select', { 'aria-label': 'Filter by category' },
    [el('option', { value: 'all', text: 'All categories' })].concat(categories.map(function (c) { return el('option', { value: c, text: c }); })));
  catSel.addEventListener('change', function () { state.category = catSel.value; render(); });
  var chainSel = el('select', { 'aria-label': 'Filter by chain' },
    [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) { return el('option', { value: c, text: c }); })));
  chainSel.addEventListener('change', function () { state.chain = chainSel.value; render(); });
  var watchBox = el('input', { type: 'checkbox', id: 'watchonly' });
  watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; render(); });
  var watchLabel = el('label', { class: 'check' }, [watchBox, document.createTextNode('Watchlist only')]);
  var tabBoard = el('button', { type: 'button', text: 'Pre-token board' });
  var tabAside = el('button', { type: 'button', text: 'Set aside (' + D.counts.products_set_aside + ')' });
  var tabLive = el('button', { type: 'button', text: 'Live tokens (set apart)' });
  function setTab(t) {
    state.tab = t;
    tabBoard.setAttribute('aria-pressed', t === 'board' ? 'true' : 'false');
    tabAside.setAttribute('aria-pressed', t === 'aside' ? 'true' : 'false');
    tabLive.setAttribute('aria-pressed', t === 'live' ? 'true' : 'false');
    render();
  }
  tabBoard.addEventListener('click', function () { setTab('board'); });
  tabAside.addEventListener('click', function () { setTab('aside'); });
  tabLive.addEventListener('click', function () { setTab('live'); });
  tabBoard.setAttribute('aria-pressed', 'true'); tabAside.setAttribute('aria-pressed', 'false'); tabLive.setAttribute('aria-pressed', 'false');
  var tabs = el('div', { class: 'tabs' }, [tabBoard, tabAside, tabLive]);
  var controls = el('div', { class: 'controls' }, [search, catSel, chainSel, watchLabel, tabs]);

  /* ---------- board table ---------- */
  function visibleRows() {
    return D.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q && r.name.toLowerCase().indexOf(state.q) < 0 && r.slug.indexOf(state.q) < 0) return false;
      return true;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    var val = {
      rank: function (r) { return r.rank; },
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    }[key];
    return list.slice().sort(function (a, b) { return (val(a) - val(b)) * dir || a.rank - b.rank; });
  }
  function sortHead(key, label, cls) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return el('th', { class: cls || '' }, [el('button', {
      type: 'button', text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' || key === 'age' ? 1 : -1; }
        render();
      },
    })]);
  }
  function verdictBadge(r) {
    return el('span', { class: 'badge verdict-' + r.farm_verdict.toLowerCase(), text: r.farm_verdict });
  }
  function boardTable() {
    var list = sorted(visibleRows());
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'count-line', text: list.length + ' of ' + D.counts.board + ' ranked protocols · click a row for its detail, comparables and farm plan' }));
    if (list.length === 0) {
      var empty = el('div', { class: 'empty' }, [
        el('div', { text: 'No protocol matches these filters.' }),
        el('button', { type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false;
          search.value = ''; catSel.value = 'all'; chainSel.value = 'all'; watchBox.checked = false; render();
        } }),
      ]);
      wrap.appendChild(empty);
      return wrap;
    }
    var head = el('tr', null, [
      sortHead('rank', '#'),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      sortHead('tvl', 'TVL', 'num'),
      sortHead('change', '7d', 'num'),
      sortHead('age', 'No-token age', 'num age-col'),
      el('th', { class: 'num', text: 'Blended ×' }),
      sortHead('implied', 'Implied launch FDV', 'num'),
      el('th', { class: 'num', text: 'Value range' }),
      el('th', { text: 'Farm' }),
    ]);
    var body = el('tbody');
    list.forEach(function (r) {
      var badges = [r.on_watchlist
        ? el('span', { class: 'badge watch', text: 'WATCHLIST' })
        : el('span', { class: 'badge early', text: 'EARLY' })];
      if (isBorderline(r)) badges.push(el('span', { class: 'badge borderline', text: 'BORDERLINE' }));
      var nameCell = el('td', null, [
        el('span', { class: 'pname', text: r.name }), badges[0], badges[1] || null,
        el('span', { class: 'pslug', text: ' ' + r.slug }),
      ]);
      var chg = el('td', { class: 'num ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat'), text: pct(r.change_7d) });
      var tr = el('tr', { tabindex: '0', 'data-slug': r.slug }, [
        el('td', { class: 'rank', text: String(r.rank) }),
        nameCell,
        el('td', { class: 'cat', text: r.category || 'Uncategorised' }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        chg,
        el('td', { class: 'num age-col', text: ageText(r.age_days) }),
        el('td', { class: 'num', text: mult(r.category_multiple) }),
        el('td', { class: 'num implied', text: usd(r.implied_value_usd) }),
        el('td', { class: 'num range', text: usd(r.range_low_usd) + ' – ' + usd(r.range_high_usd) }),
        el('td', null, [verdictBadge(r)]),
      ]);
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      body.appendChild(tr);
    });
    wrap.appendChild(el('table', null, [el('thead', null, [head]), body]));
    return wrap;
  }

  /* ---------- set-aside table: the published exclusion list ---------- */
  function asideTable() {
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'count-line', text: D.exclusions.length + ' pre-token protocols set aside before ranking — every one published with its reason. These record no token, but each is a product of something that already exists, not a launch that has not happened.' }));
    var body = el('tbody');
    D.exclusions.forEach(function (e) {
      body.appendChild(el('tr', { class: 'still' }, [
        el('td', null, [el('span', { class: 'pname', text: e.name }), el('span', { class: 'pslug', text: ' ' + e.slug })]),
        el('td', { class: 'cat', text: e.category || 'Uncategorised' }),
        el('td', { class: 'num', text: usd(e.tvl_usd) }),
        el('td', { class: 'why', text: e.reasons.join(' ') }),
      ]));
    });
    var head = el('tr', null, [el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }), el('th', { text: 'Why it is set aside' })]);
    wrap.appendChild(el('table', null, [el('thead', null, [head]), body]));
    return wrap;
  }

  /* ---------- live table ---------- */
  function liveTable() {
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'count-line', text: D.live.length + ' largest live-token protocols — these already trade, so the market prices them; they calibrate the board and are never ranked on it' }));
    var body = el('tbody');
    D.live.forEach(function (r) {
      body.appendChild(el('tr', { class: 'still' }, [
        el('td', null, [el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: ' ' + r.slug })]),
        el('td', { class: 'cat', text: r.category || 'Uncategorised' }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        el('td', { class: 'num', text: usd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
      ]));
    });
    var head = el('tr', null, [el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: '7d' })]);
    wrap.appendChild(el('table', null, [el('thead', null, [head]), body]));
    return wrap;
  }

  /* ---------- detail ---------- */
  function fact(label, value, sub) {
    var kids = [el('span', { class: 'l', text: label }), el('span', { class: 'v', text: value })];
    if (sub) kids.push(el('span', { class: 's', text: sub }));
    return el('div', { class: 'fact' }, kids);
  }
  function decompRow(label, widthPct, value) {
    return el('div', { class: 'row' }, [
      el('span', { text: label }),
      el('div', { class: 'bar' }, [el('i', { style: 'width:' + Math.max(2, Math.min(100, widthPct)) + '%' })]),
      el('span', { class: 'v', text: value }),
    ]);
  }
  function openDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    dialog.textContent = '';
    var head = el('div', { class: 'd-head' }, [
      el('div', null, [
        el('h2', { text: r.name }),
        el('p', { class: 'sub', text: 'Rank #' + r.rank + ' of ' + D.counts.board + ' · ' + (r.on_watchlist ? 'on the house watchlist' : 'early find below the $50M watchlist floor') + ' · records no token in the ' + D.as_of + ' snapshot' }),
      ]),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } }),
    ]);
    var rangeSub = r.range_basis === 'iqr'
      ? 'category interquartile band'
      : 'backtest band (thin category)';
    var facts = el('div', { class: 'facts' }, [
      fact('Implied launch FDV', usdFull(r.implied_value_usd)),
      fact('Value range', usd(r.range_low_usd) + ' – ' + usd(r.range_high_usd), rangeSub),
      fact('TVL', usdFull(r.tvl_usd)),
      fact('7d TVL change', pct(r.change_7d)),
      fact('Tracked since', r.listed_at || 'unknown'),
      fact('No-token age', ageText(r.age_days)),
      fact('Farm verdict', r.farm_verdict, '≈' + usdFull(r.farm_cost_usd) + ' gas on ' + usdFull(r.farm_capital_usd) + ' capital'),
      fact('Chains', String(r.chains.length)),
    ]);
    var kids = [facts];
    r.notes.forEach(function (n) { kids.push(el('p', { class: 'flag', text: n })); });
    var decomp = el('div', { class: 'decomp' }, [
      decompRow('TVL (snapshot)', (r.tvl_usd / D.rows[0].tvl_usd) * 100, usdFull(r.tvl_usd)),
      decompRow('Category peer median (' + r.live_peers + ' live)', r.peer_median === null ? 0 : (r.peer_median / D.constants.multiple_max) * 100, r.peer_median === null ? 'no peers' : mult(r.peer_median)),
      decompRow('Size curve at this TVL', (r.curve_multiple / D.constants.multiple_max) * 100, mult(r.curve_multiple)),
      decompRow('Blended multiple used', (r.category_multiple / D.constants.multiple_max) * 100, mult(r.category_multiple)),
      decompRow('Growth factor (7d)', ((r.growth_factor - 0.4) / 1.2) * 100, '×' + r.growth_factor.toFixed(3)),
      decompRow('Maturity factor (age)', ((r.maturity_factor - D.constants.maturity_base) / D.constants.maturity_span) * 100, '×' + r.maturity_factor.toFixed(3)),
      el('div', { class: 'row total' }, [
        el('span', { text: 'Implied launch FDV' }),
        el('span', { text: '' }),
        el('span', { class: 'v', text: usdFull(r.implied_value_usd) }),
      ]),
    ]);
    kids.push(el('h3', { class: 'steps-title', text: 'How the value is built' }));
    kids.push(decomp);
    var comps = (D.comparables[r.category || 'Uncategorised'] || []);
    kids.push(el('h3', { class: 'steps-title', text: 'Live comparables — ' + (r.category || 'Uncategorised') }));
    if (comps.length === 0) {
      kids.push(el('p', { class: 'note', text: 'No live-token protocol in this category carries both a market cap and a TVL in the snapshot, so this row is priced from the size curve alone.' }));
    } else {
      var cBody = el('tbody');
      comps.forEach(function (cp) {
        cBody.appendChild(el('tr', { class: 'still' }, [
          el('td', { text: cp.name }),
          el('td', { class: 'num', text: usd(cp.mcap_usd) }),
          el('td', { class: 'num', text: usd(cp.tvl_usd) }),
          el('td', { class: 'num', text: '×' + cp.ratio.toFixed(2) }),
        ]));
      });
      var cHead = el('tr', null, [el('th', { text: 'Live peer' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'MCap / TVL' })]);
      kids.push(el('table', { class: 'comps' }, [el('thead', null, [cHead]), cBody]));
      kids.push(el('p', { class: 'note', text: 'The largest live peers in this category in the same snapshot; the category median behind this row is ' + (r.peer_median === null ? 'not available' : mult(r.peer_median)) + ' across ' + r.live_peers + ' live peer' + (r.live_peers === 1 ? '' : 's') + ', winsorized and blended with the size curve as the methodology describes.' }));
    }
    kids.push(el('h3', { class: 'steps-title', text: 'Farm plan — ' + r.name }));
    kids.push(el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })));
    kids.push(el('p', { class: 'note', text: 'Chains: ' + (r.chains.join(', ') || 'none recorded') + '. The implied value is this board\u2019s model claim about a hypothetical launch at the snapshot\u2019s figures; it is not a prediction that a token will be issued. "Records no token" describes the DefiLlama record in the sealed snapshot, not a guarantee.' }));
    var body = el('div', { class: 'd-body' }, kids);
    dialog.appendChild(head);
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  /* ---------- methodology ---------- */
  function method() {
    var used = D.multiples.filter(function (m) { return m.live_peers > 0; })
      .sort(function (a, b) { return b.live_peers - a.live_peers; }).slice(0, 14);
    var mBody = el('tbody');
    used.forEach(function (m) {
      mBody.appendChild(el('tr', { class: 'still' }, [
        el('td', { class: 'cat', text: m.category }),
        el('td', { class: 'num', text: String(m.live_peers) }),
        el('td', { class: 'num', text: m.peer_median === null ? '—' : '×' + m.peer_median.toFixed(3) }),
        el('td', { class: 'num', text: m.peer_q25 === null ? '—' : '×' + m.peer_q25.toFixed(3) }),
        el('td', { class: 'num', text: m.peer_q75 === null ? '—' : '×' + m.peer_q75.toFixed(3) }),
      ]));
    });
    var mHead = el('tr', null, [el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live peers' }), el('th', { class: 'num', text: 'Peer median' }), el('th', { class: 'num', text: 'Peer 25th' }), el('th', { class: 'num', text: 'Peer 75th' })]);
    var btBody = el('tbody');
    [
      ['Category medians alone (the previous model)', bt.category_median_fold],
      ['Size curve alone', bt.curve_median_fold],
      ['Blend of the two — used on this board', bt.blended_median_fold],
    ].forEach(function (row) {
      btBody.appendChild(el('tr', { class: 'still' }, [
        el('td', { text: row[0] }),
        el('td', { class: 'num implied', text: row[1].toFixed(2) + '×' }),
      ]));
    });
    var btHead = el('tr', null, [el('th', { text: 'Predictor, leave-one-out on ' + bt.fit_protocols + ' live tokens' }), el('th', { class: 'num', text: 'Median fold error' })]);
    return el('section', { class: 'method' }, [
      el('h2', { text: 'How this radar values a launch that has not happened' }),
      el('p', { class: 'formula', text: 'implied launch FDV  =  TVL  ×  blended peer multiple  ×  growth factor  ×  maturity factor' }),
      el('ul', null, [
        el('li', null, [el('strong', { text: 'Blended peer multiple — ' }), document.createTextNode('each category is priced from its own live-token protocols in this same snapshot: the median market-cap / TVL of its live peers, winsorized at the live universe\u2019s 90th percentile (×' + D.winsorize_cap.toFixed(2) + '), then shrunk in log space toward a size curve fitted on all ' + bt.fit_protocols + ' live protocols — log10(multiple) = ' + D.curve.a.toFixed(3) + ' ' + (D.curve.b < 0 ? '−' : '+') + ' ' + Math.abs(D.curve.b).toFixed(3) + ' × log10(TVL). The shrink weight is the peer count itself against ' + D.constants.shrink_peers + ' pseudo-peers on the curve, so a category with one live peer leans on the curve and a category with fifteen stands on its own evidence. No protocol name is special-cased anywhere in the model.')]),
        el('li', null, [el('strong', { text: 'The model\u2019s own backtest — ' }), document.createTextNode('before pricing anything without a token, the program prices every live protocol using only the other ' + (bt.fit_protocols - 1) + ' and records the fold error. The blend is within noise of the size curve alone and far better than category medians alone — and still wrong by about ' + bt.blended_median_fold.toFixed(1) + '× at the median (' + bt.blended_within_2x_pct + '% of live protocols priced within 2×, ' + bt.blended_within_3x_pct + '% within 3×). That measured error is why every row carries a range.')]),
        el('li', null, [el('strong', { text: 'Value ranges — ' }), document.createTextNode('where a category has at least four live peers, the range is its blended interquartile band (25th–75th percentile peers, blended the same way). Where it has fewer, the range is the central value divided and multiplied by the backtest\u2019s median fold error. Each detail view names which basis its range uses.')]),
        el('li', null, [el('strong', { text: 'Growth factor — ' }), document.createTextNode('the raw 7-day TVL change is first clamped to [−80%, +200%], then 1 + 0.6 × tanh(change / 100): momentum helps, saturation caps it, so a freak +4,000% week reads as strong momentum, not a 40× valuation. A protocol the snapshot gives no 7-day change for gets a neutral factor and a flag — unknown is not zero.')]),
        el('li', null, [el('strong', { text: 'Maturity factor — ' }), document.createTextNode('0.70 rising to 1.00 over three years tracked with no token: survival is evidence a launch would meet a real product. An unreported listing date assumes one year and is flagged.')]),
        el('li', null, [el('strong', { text: 'A TVL model, stated plainly — ' }), document.createTextNode('the sealed snapshot carries no fees, revenue or volume figures, so nothing here is priced on earnings. For derivatives rows, whose TVL is posted margin, the row itself carries that warning. Treat every figure as a first-week FDV scale, not a forecast: recent launch cohorts have mostly traded below their opening valuations.')]),
        el('li', null, [el('strong', { text: 'Farm verdicts — ' }), document.createTextNode('each plan\u2019s gas is totalled (funding, the core action, one small action a week for the holding window, a claim) against working capital scaled to the protocol\u2019s size ($50–$500). FARM: gas ≤ 10% of capital. THIN: ≤ 30%. SKIP: more — the gas eats the farm. The verdict is the plan\u2019s last step, with the numbers.')]),
        el('li', null, [el('strong', { text: 'Set aside, and flagged — ' }), document.createTextNode(D.counts.products_set_aside + ' pre-token records are wrapped, staked, bridged, versioned or exchange products of something that already exists; all of them are published with reasons under “Set aside”, because a wrapped product of a trading token is not a launch that has not happened. Curator and allocator protocols (' + D.counts.borderline + ' rows) are ranked but flagged BORDERLINE: their vaults run on lending protocols that already have tokens, so an own token is plausible yet not certain — flagged, not silently decided.')]),
      ]),
      el('table', { class: 'mults' }, [el('thead', null, [btHead]), btBody]),
      el('table', { class: 'mults' }, [el('thead', null, [mHead]), mBody]),
      el('p', { class: 'note', text: 'Model ' + D.model_id + '. The page recomputes nothing: every number above is written by the same program that writes board.json, so the screenshots, the board and this source agree by construction. Two runs of the program over the sealed snapshot write byte-identical output.' }),
    ]);
  }

  /* ---------- render ---------- */
  function render() {
    boardEl.textContent = '';
    boardEl.appendChild(controls);
    boardEl.appendChild(state.tab === 'board' ? boardTable() : state.tab === 'aside' ? asideTable() : liveTable());
    boardEl.appendChild(method());
  }
  render();

  var foot = document.createElement('footer');
  foot.textContent = 'Source: ' + D.source + ' · Watchlist floor ' + usd(D.floor_usd) + ' · Implied values are this board\u2019s own model claims, not make.fun\u2019s and not financial advice.';
  document.body.appendChild(foot);
})();
