// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The page is also the model's second opinion: it recomputes each row from the snapshot figures
// and checks the number board.json carries, so the page and the board visibly run the same
// arithmetic. Farm plans are re-derived here too, from the same category, chain, TVL and age
// inputs main.ts uses — no name is ever special-cased on either side.
(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function percent(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // Distinct chains only: a repeated chain name does not widen a protocol's distribution.
  function countChains(list) { return new Set(list || []).size; }
  function recomputeImplied(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extraChains = Math.min(Math.max(countChains(row.chains) - 1, 0), model.breadth_max_chains);
    var breadth = 1 + model.breadth_per_chain * extraChains;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }

  // A tiny element builder: tag, attributes (class/text/on* handlers/anything else), then children.
  function node(tag, attrs) {
    var element = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') element.className = attrs[k];
        else if (k === 'text') element.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') element.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) element.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) element.appendChild(c); });
      else if (typeof child === 'string') element.appendChild(document.createTextNode(child));
      else element.appendChild(child);
    }
    return element;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalForTvl(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function mainAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote on its next proposal.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the receipts.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyAction(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'repay a small borrow, top up collateral, or adjust the supplied amount';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'swap a small amount through the pool or rebalance the range';
    if (c.indexOf('bridge') >= 0) return 'bridge a small amount back and use it in the app';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'claim or compound the staking rewards';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'close the hedge and open a fresh small one';
    if (c.indexOf('prediction') >= 0) return 'settle one market position and open the next';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'move a small amount between two of the vaults';
    if (c.indexOf('governance') >= 0) return 'vote on the newest proposal';
    return 'make one deposit, swap or vote';
  }
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planSteps(p) {
    var chain = firstChain(p);
    var capital = capitalForTvl(p);
    var hold = holdDays(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Once a week, do one qualifying action on ' + chain + ' — ' + weeklyAction(p) + ' — so the activity never goes quiet.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates, the amounts and every transaction in a farm log, and compare the protocol\'s TVL each week.', cost: 'nothing but the log', time: '5 minutes a week' },
      { text: 'Never deposit more than you can afford to lose: this protocol records no token, so a launch may never come.', cost: 'nothing to remember, everything to lose if ignored', time: '1 minute' }
    ].map(renderStep);
  }

  // Deep-link state lives in the location hash, so the board, detail and filtered screenshots are
  // plain URLs: #p=<slug> opens a protocol, #category=…&watchlist=1 filters the board.
  function readLocation() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('watchlist')) view.watchlistOnly = params.get('watchlist') === '1';
  }
  function writeLocation() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.watchlistOnly) params.set('watchlist', '1');
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var query = view.q.trim().toLowerCase();
    return RADAR.rows.filter(function (r) {
      if (view.watchlistOnly && !r.on_watchlist) return false;
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).includes(view.chain)) return false;
      if (!query) return true;
      var haystack = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(query) >= 0;
    });
  }
  function orderedRows(list) {
    var sortKey = view.sort;
    return list.slice().sort(function (a, b) {
      var aVal, bVal;
      if (sortKey === 'name') { aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); }
      else if (sortKey === 'tvl') { aVal = a.tvl_usd; bVal = b.tvl_usd; }
      else if (sortKey === 'growth') { aVal = a.change_7d === null ? -Infinity : a.change_7d; bVal = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (sortKey === 'age') { aVal = a.age_days === null ? Infinity : a.age_days; bVal = b.age_days === null ? Infinity : b.age_days; }
      else { aVal = a.implied_value_usd; bVal = b.implied_value_usd; }
      if (aVal < bVal) return -view.dir;
      if (aVal > bVal) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function boardFigures() {
    var tvlTotal = RADAR.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    var implieds = RADAR.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var middle = implieds.length % 2 === 1 ? implieds[(implieds.length - 1) / 2] : Math.round((implieds[implieds.length / 2 - 1] + implieds[implieds.length / 2]) / 2);
    var categoryCount = new Set(RADAR.rows.map(function (r) { return r.category || 'Other'; })).size;
    return { totalTvl: tvlTotal, median: middle, categories: categoryCount };
  }

  function topBar() {
    return node('header', { class: 'top' },
      node('div', { class: 'brand' }, node('span', { class: 'mark' }), node('span', { class: 'brand-name', text: 'Token Radar' })),
      node('div', { class: 'top-meta' },
        node('span', { text: 'Snapshot ' + RADAR.as_of }),
        node('span', { text: 'DefiLlama protocol index' }),
        node('span', { text: RADAR.model_version + ' model' })
      )
    );
  }

  function intro() {
    var figures = boardFigures();
    return node('section', { class: 'lede' },
      node('div', null,
        node('h1', { text: RADAR.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        node('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + RADAR.early_size + ' pre-token protocols below that floor, each passing the same wrapped-and-staked exclusion. Implied value is a model, not a promise.' })
      ),
      node('div', { class: 'facts' },
        node('div', { class: 'fact' }, node('span', { text: 'Watchlist covered' }), node('b', { text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })),
        node('div', { class: 'fact' }, node('span', { text: 'Pre-token rows scored' }), node('b', { text: String(RADAR.board_size) })),
        node('div', { class: 'fact' }, node('span', { text: 'Board TVL' }), node('b', { text: money(figures.totalTvl) })),
        node('div', { class: 'fact' }, node('span', { text: 'Median implied value' }), node('b', { text: money(figures.median) })),
        node('div', { class: 'fact' }, node('span', { text: 'Categories on the board' }), node('b', { text: String(figures.categories) })),
        node('div', { class: 'fact' }, node('span', { text: 'Live-token protocols set aside' }), node('b', { text: String(RADAR.live_size) }))
      )
    );
  }

  function filterBar() {
    var categoryNames = Array.from(new Set(RADAR.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainNames = Array.from(new Set(RADAR.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var searchBox = node('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    searchBox.addEventListener('input', function () { view.q = searchBox.value; writeLocation(); paint(); });
    var categoryPick = node('select', { id: 'category', 'aria-label': 'Filter by category' },
      node('option', { value: 'all', text: 'All categories' }),
      categoryNames.map(function (c) { return node('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    categoryPick.addEventListener('change', function () { view.category = categoryPick.value; writeLocation(); paint(); });
    var chainPick = node('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      node('option', { value: 'all', text: 'All chains' }),
      chainNames.map(function (c) { return node('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainPick.addEventListener('change', function () { view.chain = chainPick.value; writeLocation(); paint(); });
    var watchToggle = node('input', { type: 'checkbox', id: 'watchlist-only', checked: view.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchToggle.addEventListener('change', function () { view.watchlistOnly = watchToggle.checked; writeLocation(); paint(); });
    var preTab = node('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var liveTab = node('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    return node('div', { class: 'controls' },
      node('div', { class: 'field' }, node('label', { for: 'q', text: 'Search' }), searchBox),
      node('div', { class: 'field' }, node('label', { for: 'category', text: 'Category' }), categoryPick),
      node('div', { class: 'field' }, node('label', { for: 'chain', text: 'Chain' }), chainPick),
      node('label', { class: 'check', for: 'watchlist-only' }, watchToggle, 'Watchlist only'),
      node('div', { class: 'field' }, node('span', { class: 'sub', text: 'Token status' }), node('div', { class: 'tabs' }, preTab, liveTab)),
      node('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : RADAR.live.length + ' live-token protocols' })
    );
  }

  function sortButton(key, label) {
    return node('th', { scope: 'col' },
      node('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? node('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardView() {
    var shown = orderedRows(visibleRows());
    if (shown.length === 0) {
      return node('div', { class: 'panel' }, node('div', { class: 'empty' },
        node('h2', { text: 'No protocol matches that filter' }),
        node('p', { text: 'Clear the search or pick another category to see the board again.' }),
        node('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.watchlistOnly = false; writeLocation(); paint(); } })
      ));
    }
    var topValue = shown[0].implied_value_usd || 1;
    var body = node('tbody');
    shown.forEach(function (r) {
      var growthText = r.change_7d === null ? 'n/a' : percent(r.change_7d);
      var growthTone = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameBox = node('div', { class: 'name' },
        node('b', { text: r.name }),
        node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      );
      if (r.on_watchlist) nameBox.appendChild(node('span', { class: 'badge', text: 'WATCHLIST' }));
      var rowEl = node('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      },
        node('td', { class: 'num', text: String(r.rank) }),
        node('td', null, nameBox),
        node('td', { class: 'num', text: money(r.tvl_usd) }),
        node('td', { class: 'num ' + growthTone, text: growthText }),
        node('td', { class: 'num', text: ageLabel(r.age_days) }),
        node('td', null, node('div', { class: 'implied' },
          node('div', { class: 'bar', 'aria-hidden': 'true' }, node('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / topValue) * 100)) + '%' })),
          node('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        node('td', null, node('span', { class: 'status', text: 'no token' }))
      );
      body.appendChild(rowEl);
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          node('thead', null, node('tr', null,
            sortButton('implied', 'Rank'),
            sortButton('name', 'Protocol'),
            sortButton('tvl', 'TVL'),
            sortButton('growth', '7d'),
            sortButton('age', 'Age'),
            sortButton('implied', 'Implied value'),
            node('th', { scope: 'col', text: 'Token' })
          )),
          body
        )
      )
    );
  }

  function liveView() {
    var body = node('tbody');
    RADAR.live.forEach(function (r) {
      body.appendChild(node('tr', null,
        node('td', { class: 'num', text: 'live' }),
        node('td', null, node('div', { class: 'name' }, node('b', { text: r.name }), node('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        node('td', { class: 'num', text: money(r.tvl_usd) }),
        node('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: percent(r.change_7d) }),
        node('td', { class: 'num', text: money(r.mcap_usd) }),
        node('td', null, node('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return node('div', { class: 'panel' },
      node('div', { class: 'table-wrap' },
        node('table', null,
          node('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Status' }), node('th', { scope: 'col', text: 'Protocol' }), node('th', { scope: 'col', text: 'TVL' }), node('th', { scope: 'col', text: '7d' }), node('th', { scope: 'col', text: 'Market cap' }), node('th', { scope: 'col', text: 'Token' }))),
          body
        )
      )
    );
  }

  function modelSection() {
    var model = RADAR.model;
    return node('section', { class: 'panel model' },
      node('h2', { text: 'How implied value is computed' }),
      node('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      node('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + model.base_multiple.toFixed(4) + ' x (1 + clamp(change_7d, ' + model.growth_floor + ', ' + model.growth_cap + ') / 100 x ' + model.growth_weight + ') x (' + model.maturity_floor + ' + min(age_days, ' + model.maturity_days + ') / ' + model.maturity_days + ' x ' + model.maturity_range + ') x (1 + 0.04 x min(distinct chains - 1, 10)) )'
      ),
      node('p', { class: 'sub', text: 'The base multiple ' + model.base_multiple.toFixed(4) + ' is the median market-cap-to-TVL ratio of the ' + RADAR.live_calibration_n + ' live-token protocols in this snapshot: a launch is priced the way the market already prices the tokens that trade. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + model.unknown_age_days + ' days. Chain breadth rewards distribution: a protocol live on more chains reaches more farmers. The early radar is every pre-token protocol below the watchlist floor that passes the same wrapped-and-staked exclusion, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function readerSection() {
    return node('section', { class: 'panel readme' },
      node('h2', { text: 'How to read this radar' }),
      node('p', { text: '“No token” means the protocol records no token in this snapshot — it may still have one the record does not carry. Implied value is the entry’s own claim about what a launch would be worth if the protocol’s record stayed as it is; it does not predict whether or when a token is issued. The board sorts by implied value, the detail view shows the model’s inputs for one protocol, and the farm plan is seven steps with a cost and a time each.' }),
      node('p', { text: 'Rank 1 is the board’s most valuable protocol. Use the search, the category and chain filters, and the watchlist toggle to narrow it; the Live token tab shows the protocols that already trade, for comparison.' })
    );
  }

  var detailDialog = node('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailDialog.addEventListener('close', function () { view.selected = null; writeLocation(); });

  function showDetail(slug) {
    var entry = RADAR.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!entry) return;
    view.selected = slug;
    writeLocation();
    detailDialog.textContent = '';
    var plan = planSteps(entry);
    detailDialog.appendChild(node('div', { class: 'detail-head' },
      node('div', null,
        node('span', { class: 'brand-name', text: 'Rank ' + entry.rank + ' of ' + RADAR.board_size + (entry.on_watchlist ? ' — watchlist' : ' — early radar') }),
        node('h2', { id: 'detail-title', text: entry.name }),
        node('p', { class: 'sub', text: (entry.category || 'Other') + ' on ' + (entry.chains && entry.chains.length ? entry.chains.join(', ') : 'an unnamed chain') })
      ),
      node('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { detailDialog.close(); } })
    ));
    detailDialog.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Implied value' }),
      node('div', { class: 'equation' },
        node('div', null, node('span', { text: 'TVL' }), node('b', { class: 'num', text: money(entry.tvl_usd) })),
        node('div', null, node('span', { text: 'Seven-day growth' }), node('b', { class: 'num', text: percent(entry.change_7d) })),
        node('div', null, node('span', { text: 'Age with no token' }), node('b', { class: 'num', text: ageLabel(entry.age_days) })),
        node('div', null, node('span', { text: 'Chains' }), node('b', { class: 'num', text: String((entry.chains || []).length) })),
        node('div', null, node('span', { text: 'Growth multiplier' }), node('b', { class: 'num', text: String(entry.growth_multiplier) })),
        node('div', null, node('span', { text: 'Maturity multiplier' }), node('b', { class: 'num', text: String(entry.maturity_multiplier) })),
        node('div', null, node('span', { text: 'Breadth multiplier' }), node('b', { class: 'num', text: String(entry.breadth_multiplier) })),
        node('div', null, node('span', { text: 'Implied value' }), node('b', { class: 'num', text: money(entry.implied_value_usd) }))
      ),
      node('p', { class: 'sub', text: 'Model ' + RADAR.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputeImplied(entry, RADAR.model)) + (recomputeImplied(entry, RADAR.model) === entry.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    detailDialog.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Farm plan' }),
      node('ol', { class: 'steps' }, plan.map(function (s) {
        var cut = s.indexOf(' Cost: ');
        var actionText = cut >= 0 ? s.slice(0, cut) : s;
        var tailText = cut >= 0 ? s.slice(cut + 1) : '';
        return node('li', null, node('b', { text: actionText }), node('span', { class: 'cost', text: tailText }));
      }))
    ));
    if (typeof detailDialog.showModal === 'function') {
      if (!detailDialog.open) detailDialog.showModal();
    } else {
      detailDialog.setAttribute('open', '');
    }
  }

  // One full paint: header, lede, filters, the board or live table, the model and reader panels.
  function paint() {
    mount.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardView() : liveView());
    if (view.tab === 'pre-token') shell.appendChild(modelSection());
    if (view.tab === 'pre-token') shell.appendChild(readerSection());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!detailDialog.isConnected) mount.appendChild(detailDialog);
    if (view.selected) showDetail(view.selected);
  }

  readLocation();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailDialog.open) detailDialog.close();
  });
})();
