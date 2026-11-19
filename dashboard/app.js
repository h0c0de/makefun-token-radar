/* Token Launch Radar — the page. Renders window.RADAR (written by main.ts beside this
   folder as ../data.js): a sortable, filterable board of pre-token protocols ranked by
   implied value, a detail view per protocol with the model's arithmetic shown, a farm
   plan per protocol, a live-token view kept apart from the ranking, and the methodology
   with the calibrated category multiples. No network, no framework. */
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

  /* ---------- masthead ---------- */
  function stat(n, label, cls) {
    return el('div', { class: 'stat' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'n', text: String(n) }),
      el('span', { class: 'l', text: label }),
    ]);
  }
  mast.appendChild(el('p', { class: 'kicker', text: 'Token launch radar · snapshot ' + D.as_of }));
  mast.appendChild(el('h1', null, [
    document.createTextNode('Protocols that have not launched a token, '),
    el('span', { class: 'thin', text: 'ranked by what a launch could be worth.' }),
  ]));
  mast.appendChild(el('p', { class: 'lede', text:
    'Every protocol in the sealed DefiLlama snapshot was checked for a token. Those that record none were ' +
    'valued the way the market already values their live peers — TVL times a category multiple calibrated ' +
    'from this same snapshot, adjusted for seven-day momentum and for time survived with no token. ' +
    'Wrapped, staked and bridged products of tokens that already trade are set aside, not ranked.' }));
  var stats = el('div', { class: 'stats' }, [
    stat(D.counts.protocols, 'protocols scanned'),
    stat(D.counts.pre_token, 'record no token'),
    stat(D.counts.board, 'ranked on the board', 'hot'),
    stat(D.counts.watchlist + ' / ' + D.counts.watchlist, 'watchlist covered', 'warn'),
    stat(D.counts.early, 'early finds below the floor'),
    stat(D.counts.products_set_aside, 'products set aside'),
  ]);
  mast.appendChild(stats);

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
  var tabLive = el('button', { type: 'button', text: 'Live tokens (set apart)' });
  function setTab(t) { state.tab = t; tabBoard.setAttribute('aria-pressed', t === 'board' ? 'true' : 'false'); tabLive.setAttribute('aria-pressed', t === 'live' ? 'true' : 'false'); render(); }
  tabBoard.addEventListener('click', function () { setTab('board'); });
  tabLive.addEventListener('click', function () { setTab('live'); });
  tabBoard.setAttribute('aria-pressed', 'true'); tabLive.setAttribute('aria-pressed', 'false');
  var tabs = el('div', { class: 'tabs' }, [tabBoard, tabLive]);
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
  function boardTable() {
    var list = sorted(visibleRows());
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'count-line', text: list.length + ' of ' + D.counts.board + ' ranked protocols · click a row for its detail and farm plan' }));
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
      el('th', { class: 'chains-col', text: 'Chains' }),
      sortHead('tvl', 'TVL', 'num'),
      sortHead('change', '7d', 'num'),
      sortHead('age', 'No-token age', 'num age-col'),
      el('th', { class: 'num', text: 'Peer ×' }),
      sortHead('implied', 'Implied value', 'num'),
    ]);
    var body = el('tbody');
    list.forEach(function (r) {
      var badge = r.on_watchlist
        ? el('span', { class: 'badge watch', text: 'WATCHLIST' })
        : el('span', { class: 'badge early', text: 'EARLY' });
      var nameCell = el('td', null, [
        el('span', { class: 'pname', text: r.name }), badge,
        el('span', { class: 'pslug', text: r.slug }),
      ]);
      var chg = el('td', { class: 'num ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat'), text: pct(r.change_7d) });
      var tr = el('tr', { tabindex: '0', 'data-slug': r.slug }, [
        el('td', { class: 'rank', text: String(r.rank) }),
        nameCell,
        el('td', { class: 'cat', text: r.category || 'Uncategorised' }),
        el('td', { class: 'chains chains-col', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: usd(r.tvl_usd) }),
        chg,
        el('td', { class: 'num age-col', text: ageText(r.age_days) }),
        el('td', { class: 'num', text: mult(r.category_multiple) }),
        el('td', { class: 'num implied', text: usd(r.implied_value_usd) }),
      ]);
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      body.appendChild(tr);
    });
    wrap.appendChild(el('table', null, [el('thead', null, [head]), body]));
    return wrap;
  }

  /* ---------- live table ---------- */
  function liveTable() {
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'count-line', text: D.live.length + ' largest live-token protocols — these already trade, so the market prices them; they calibrate the board and are never ranked on it' }));
    var body = el('tbody');
    D.live.forEach(function (r) {
      body.appendChild(el('tr', null, [
        el('td', null, [el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: r.slug })]),
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
  function fact(label, value) { return el('div', { class: 'fact' }, [el('span', { class: 'l', text: label }), el('span', { class: 'v', text: value })]); }
  function decompRow(label, widthPct, value, strong) {
    return el('div', { class: 'row' }, [
      el('span', { text: label }),
      el('div', { class: 'bar' }, [el('i', { class: strong ? 'strong' : '', style: 'width:' + Math.max(2, Math.min(100, widthPct)) + '%' })]),
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
    var facts = el('div', { class: 'facts' }, [
      fact('Implied value', usdFull(r.implied_value_usd)),
      fact('TVL', usdFull(r.tvl_usd)),
      fact('7d TVL change', pct(r.change_7d)),
      fact('Tracked since', r.listed_at || 'unknown'),
      fact('No-token age', ageText(r.age_days)),
      fact('Chains', String(r.chains.length)),
    ]);
    var decomp = el('div', { class: 'decomp' }, [
      decompRow('TVL (snapshot)', (r.tvl_usd / D.rows[0].tvl_usd) * 100, usdFull(r.tvl_usd), false),
      decompRow('Category peer multiple', (r.category_multiple / D.constants.multiple_max) * 100, mult(r.category_multiple), false),
      decompRow('Growth factor (7d)', ((r.growth_factor - 0.4) / 1.2) * 100, '×' + r.growth_factor.toFixed(3), false),
      decompRow('Maturity factor (age)', ((r.maturity_factor - D.constants.maturity_base) / D.constants.maturity_span) * 100, '×' + r.maturity_factor.toFixed(3), false),
      el('div', { class: 'row total' }, [
        el('span', { text: 'Implied launch value' }),
        el('span', { text: '' }),
        el('span', { class: 'v', text: usdFull(r.implied_value_usd) }),
      ]),
    ]);
    var steps = el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); }));
    var body = el('div', { class: 'd-body' }, [
      facts,
      el('h3', { class: 'steps-title', text: 'How the value is built' }),
      decomp,
      el('h3', { class: 'steps-title', text: 'Farm plan — ' + r.name }),
      steps,
      el('p', { class: 'note', text: 'Chains: ' + (r.chains.join(', ') || 'none recorded') + '. The implied value is this board\u2019s model claim about a hypothetical launch at today\u2019s figures; it is not a prediction that a token will be issued. "Records no token" describes the DefiLlama record in the sealed snapshot, not a guarantee.' }),
    ]);
    dialog.appendChild(head);
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  /* ---------- methodology ---------- */
  function method() {
    var used = D.multiples.filter(function (m) { return m.live_peers > 0; })
      .sort(function (a, b) { return b.multiple - a.multiple; }).slice(0, 14);
    var mBody = el('tbody');
    used.forEach(function (m) {
      mBody.appendChild(el('tr', null, [
        el('td', { class: 'cat', text: m.category }),
        el('td', { class: 'num', text: String(m.live_peers) }),
        el('td', { class: 'num', text: m.peer_median === null ? '—' : '×' + m.peer_median.toFixed(3) }),
        el('td', { class: 'num implied', text: mult(m.multiple) }),
      ]));
    });
    var mHead = el('tr', null, [el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live peers' }), el('th', { class: 'num', text: 'Peer median' }), el('th', { class: 'num', text: 'Multiple used' })]);
    return el('section', { class: 'method' }, [
      el('h2', { text: 'How this radar values a launch that has not happened' }),
      el('p', { class: 'formula', text: 'implied value  =  TVL  ×  category peer multiple  ×  growth factor  ×  maturity factor' }),
      el('ul', null, [
        el('li', null, [el('strong', { text: 'Category peer multiple — ' }), document.createTextNode('the median market-cap / TVL of this snapshot\u2019s own live-token protocols in the same category, winsorized at the live universe\u2019s 90th percentile (×' + D.winsorize_cap.toFixed(2) + ') and shrunk toward the global median (×' + D.global_multiple.toFixed(3) + ') so a category with one or two peers cannot set a wild level. No protocol name is special-cased anywhere in the model.')]),
        el('li', null, [el('strong', { text: 'Growth factor — ' }), document.createTextNode('1 + 0.6 × tanh(7-day TVL change / 100): momentum helps, saturation caps it, so a freak +4,000% week reads as strong momentum, not a 40× valuation.')]),
        el('li', null, [el('strong', { text: 'Maturity factor — ' }), document.createTextNode('0.70 rising to 1.00 over three years tracked with no token: survival is evidence a launch would meet a real product.')]),
        el('li', null, [el('strong', { text: 'Set aside, never ranked — ' }), document.createTextNode(D.counts.products_set_aside + ' pre-token records are wrapped, staked, bridged, versioned or exchange products of something that already exists, and ' + D.counts.live + ' large live-token protocols are shown on their own tab. A wrapped product of a trading token is not a launch that has not happened.')]),
      ]),
      el('table', { class: 'mults' }, [el('thead', null, [mHead]), mBody]),
      el('p', { class: 'note', text: 'Model ' + D.model_id + '. The page recomputes nothing: every number above is written by the same program that writes board.json, so the screenshots, the board and this source agree by construction.' }),
    ]);
  }

  /* ---------- render ---------- */
  function render() {
    boardEl.textContent = '';
    boardEl.appendChild(controls);
    boardEl.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    boardEl.appendChild(method());
  }
  render();

  var foot = document.createElement('footer');
  foot.textContent = 'Source: ' + D.source + ' · Watchlist floor ' + usd(D.floor_usd) + ' · Implied values are this board\u2019s own model claims, not make.fun\u2019s and not financial advice.';
  document.body.appendChild(foot);
})();
