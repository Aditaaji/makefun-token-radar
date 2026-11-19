// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null, compare: [] };
  var WATCHLIST = {};
  (DATA.watchlist || []).forEach(function (s) { WATCHLIST[s] = true; });

  // The sandbox model: the fitted constants, with the three the sandbox panel lets a reader move.
  // It changes this page only; board.json keeps the fitted model.
  function sandboxModel() {
    if (!state.sandbox) return DATA.model;
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    m.growth_weight = state.sandbox.growth_weight;
    m.multiple_cap = state.sandbox.multiple_cap;
    m.chain_step = state.sandbox.chain_step;
    return m;
  }
  // The rows as the page shows them: under the sandbox, implied values are recomputed with the
  // moved constants (each row's own category multiple is capped by the sandbox's multiple cap)
  // and re-ranked, so a reader sees what the model choice does to the board.
  function effectiveRows() {
    var model = sandboxModel();
    var list = DATA.rows.map(function (r) {
      var mult = Math.min(model.multiple_cap, Math.max(model.multiple_floor, r.category_multiple));
      var row = {};
      Object.keys(r).forEach(function (k) { row[k] = r[k]; });
      row.display_implied = impliedOf(row, model, mult);
      row.display_rank = r.rank;
      return row;
    });
    if (!state.sandbox) return list;
    list.sort(function (a, b) { return b.display_implied - a.display_implied || (a.slug < b.slug ? -1 : 1); });
    list.forEach(function (r, i) { r.display_rank = i + 1; });
    return list;
  }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // The multiplication order matches lib/model.ts exactly, so the recompute is bit-identical.
  function impliedOf(row, model, mult) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var multiple = mult === undefined ? row.category_multiple : mult;
    var effective = Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiple * (row.size_multiplier || 1)));
    return Math.max(1, Math.round(row.tvl_usd * effective * growthMult * maturity * row.chain_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('options') >= 0) return 'Deposit $' + capital + ' into an ' + name + ' options vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Top up $' + capital + ' through ' + name + ' on ' + chain + ' and spend from the balance.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + chain + ' and use one native app on it through ' + name + '.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s shielded pool on " + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the supply on ' + name + ', then repay it in the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return "Make one swap through " + name + "'s main pool on " + chain + ' for about $10 of volume.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back through ' + name + ' so the round trip is on record.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards ' + name + ' shows and restake them in the same position.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Close the hedge on ' + name + ' and open a fresh one half its size.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market on ' + name + ' and place a second position in another.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move $' + small + ' into a second ' + name + ' vault on ' + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Redeem a small part of the stable position on ' + name + ' and mint it back.';
    if (c.indexOf('rwa') >= 0) return 'Claim the yield the ' + name + ' asset accrued and hold the rest.';
    if (c.indexOf('insurance') >= 0) return 'File one test claim on ' + name + ' to learn the flow, then keep the policy.';
    if (c.indexOf('options') >= 0) return 'Roll one options position in the ' + name + ' vault to the next expiry.';
    if (c.indexOf('index') >= 0) return 'Rebalance the ' + name + ' index holding once, then hold it again.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Make one purchase with the ' + name + ' balance and top it up again.';
    if (c.indexOf('chain') >= 0) return 'Use a second native app on ' + chain + ' through ' + name + ' in the same week.';
    if (c.indexOf('privacy') >= 0) return 'Withdraw a small amount from the ' + name + ' pool and deposit it back.';
    return 'Do one more distinct action on ' + name + ', such as a swap, a vote or a second deposit.';
  }
  function weeklyActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Each week, supply $' + small + ' more to ' + name + ' or borrow $' + small + ' against the supply and repay it.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return "Each week, collect the fees " + name + "'s pool earned and compound them back in.";
    if (c.indexOf('bridge') >= 0) return 'Each week, bridge $' + small + ' to ' + chain + ' through ' + name + ' and use the bridged funds.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Each week, top up the stake on ' + name + ' by $' + small + '.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Each week, open one small hedge on ' + name + ' and close it before the week ends.';
    if (c.indexOf('prediction') >= 0) return 'Each week, place a $10 market position on ' + name + ' in a market closing that week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Each week, check the " + name + " vaults' yields and move $" + small + ' to the highest-yielding vault on ' + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Each week, move $' + small + ' of the stable asset through ' + name + ' into a yield venue on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Each week, mint $' + small + ' more of the ' + name + ' yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Each week, check the ' + name + ' cover on ' + chain + ' and extend it before it lapses.';
    if (c.indexOf('options') >= 0) return 'Each week, add $' + small + ' to the ' + name + ' options vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('index') >= 0) return 'Each week, buy $' + small + ' more of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Each week, top up the ' + name + ' balance by $' + small + ' and spend it from the balance.';
    if (c.indexOf('chain') >= 0) return 'Each week, use a native app on ' + chain + ' through ' + name + ' that you have not used yet.';
    if (c.indexOf('privacy') >= 0) return 'Each week, move $' + small + ' between two shielded pools on ' + name + '.';
    return 'Each week, make one qualifying action on ' + name + ', such as a deposit, a borrow, a swap or a vote.';
  }
  function weeklyCostFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('insurance') >= 0) return 'the weekly premium, plus about $2 of gas';
    return 'about $2 of gas a week';
  }
  function rewardsActionFor(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return "Check " + name + "'s rewards page for supply and borrow incentives and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return "Check " + name + "'s points page for LP and swap quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('bridge') >= 0) return "Check " + name + "'s rewards page for bridge quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Check " + name + "'s staking page for staking quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return "Check " + name + "'s trading rewards page for volume quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('prediction') >= 0) return "Check " + name + "'s rewards page for market quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Check " + name + "'s vault rewards page for deposit quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('stable') >= 0) return "Check " + name + "'s rewards page for stable-mint quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('rwa') >= 0) return "Check " + name + "'s rewards page for holding quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('insurance') >= 0) return "Check " + name + "'s rewards page for cover quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('options') >= 0) return "Check " + name + "'s vault rewards page for deposit quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('index') >= 0) return "Check " + name + "'s rewards page for holding quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return "Check " + name + "'s rewards page for spend quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('chain') >= 0) return "Check " + name + "'s ecosystem quests page for ecosystem quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    if (c.indexOf('privacy') >= 0) return "Check " + name + "'s rewards page for pool quests and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
    return "Once a week open the protocol's own points or rewards page and follow only the quests it lists there; never pay to claim and never use a link from a chat or a post.";
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmCostUsd(p) {
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return 3 + (capital >= 150 ? 8 : 4) + (capital >= 150 ? 5 : 2) + 2 * Math.ceil(hold / 7);
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var cost = farmCostUsd(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + (capital >= 150 ? 5 : 2) + ' of gas', time: '10 minutes' },
      { text: weeklyActionFor(p, capital, chain), cost: weeklyCostFor(p), time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: rewardsActionFor(p), cost: 'no fee to check', time: '10 minutes a week' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Break even: this plan costs about $' + cost + ' of gas over ' + hold + ' days, and the $' + capital + ' of capital stays in the position. It pays only if the eventual allocation is worth more than $' + cost + '; if no token ever launches, the $' + cost + ' is the loss.', cost: 'about $' + cost + ' of gas in total', time: hold + ' days' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return effectiveRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.display_implied; bv = b.display_implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function downloadCsv() {
    var head = 'rank,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,category_multiple,size_multiplier,rank_lo,rank_hi,farm_cost_usd\n';
    var lines = sortedRows(rows()).map(function (r) {
      var q = function (v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; };
      return [r.display_rank, q(r.name), q(r.category || ''), q((r.chains || []).join(';')), r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.display_implied, r.category_multiple, r.size_multiplier, r.rank_lo, r.rank_hi, r.farm_cost_usd].join(',');
    });
    var blob = new Blob([head + lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function header() {
    var themeBtn = el('button', { class: 'button', type: 'button', text: document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light theme' : 'Dark theme', onclick: function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      themeBtn.textContent = next === 'dark' ? 'Light theme' : 'Dark theme';
    } });
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' }),
        themeBtn
      )
    );
  }

  function lede() {
    var v = DATA.validation;
    var acc = DATA.accounting;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. A category is priced at the median market-cap-to-TVL of its live protocols, taken in log space and shrunk toward the global median, so a lending protocol is not priced like a DEX and a category with one live protocol does not swing on it. The fitted multiples beat one flat multiple by ' + v.improvement_pct + '% out of sample (median log error ' + v.oos_median_log_error + ' vs ' + v.flat_median_log_error + ', two split-half tests, n=' + v.oos_n_test + ' each). All ' + acc.total + ' protocols in the snapshot are accounted for: ' + acc.ranked + ' ranked, ' + acc.live + ' live, ' + acc.excluded + ' set aside with the rule that set them aside. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols accounted for' }), el('b', { text: String(acc.total) + ' / ' + String(acc.total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Out-of-sample edge over flat' }), el('b', { text: '+' + String(v.improvement_pct) + '%' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var aside = el('button', { type: 'button', 'aria-pressed': state.tab === 'set-aside' ? 'true' : 'false', text: 'Set aside', onclick: function () { state.tab = 'set-aside'; render(); } });
    var csvBtn = el('button', { class: 'button', type: 'button', text: 'Download CSV', onclick: downloadCsv });
    var tabCount = state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.accounting.excluded_rows.length + ' pre-token protocols set aside';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, aside)),
      csvBtn,
      el('span', { class: 'count', text: tabCount })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var checked = state.compare.indexOf(r.slug) >= 0;
      var box = el('input', { type: 'checkbox', 'aria-label': 'Compare ' + r.name, checked: checked ? 'checked' : null });
      box.addEventListener('click', function (e) { e.stopPropagation(); });
      box.addEventListener('change', function () {
        if (box.checked) {
          if (state.compare.length >= 3) { box.checked = false; return; }
          state.compare.push(r.slug);
        } else {
          state.compare = state.compare.filter(function (s) { return s !== r.slug; });
        }
        render();
      });
      var rankCell = el('td', { class: 'num' },
        el('div', { class: 'name' }, el('b', { text: String(r.display_rank) }), el('span', { class: 'sub', text: state.sandbox ? 'board ' + r.rank : 'range ' + r.rank_lo + '–' + r.rank_hi }))
      );
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        rankCell,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          WATCHLIST[r.slug] ? el('span', { class: 'tag', text: 'Watchlist' }) : null,
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.display_implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.display_implied) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' })),
        el('td', null, box)
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. Tick up to three rows to compare them. Rank range is the 10th–90th percentile rank over ' + DATA.validation.bootstrap_refits + ' bootstrap refits of the calibration.' + (state.sandbox ? ' Sandbox is on: values and ranks are recomputed with your constants, not the fitted ones.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' }),
            el('th', { scope: 'col', text: 'Compare' })
          )),
          tbody
        )
      )
    );
  }

  function comparePanel() {
    if (state.compare.length === 0) return null;
    var picked = state.compare.map(function (slug) {
      return effectiveRows().filter(function (r) { return r.slug === slug; })[0];
    }).filter(function (r) { return r; });
    if (picked.length === 0) return null;
    var head = el('tr', null, el('th', { scope: 'col', text: '' }), picked.map(function (r) { return el('th', { scope: 'col', text: r.name }); }));
    var rowFor = function (label, fn) {
      return el('tr', null, el('td', null, el('b', { text: label })), picked.map(function (r) { return el('td', { class: 'num', text: fn(r) }); }));
    };
    var clear = el('button', { class: 'button', type: 'button', text: 'Clear comparison', onclick: function () { state.compare = []; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Compare (' + picked.length + ' of 3)' }),
      el('p', { class: 'sub', text: 'The same model, side by side. Rank range is the 10th–90th percentile over ' + DATA.validation.bootstrap_refits + ' bootstrap refits; farm cost is the plan\u2019s total gas.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, head),
          el('tbody', null,
            rowFor('Board rank', function (r) { return String(r.rank) + ' (range ' + r.rank_lo + '–' + r.rank_hi + ')'; }),
            rowFor('Implied value', function (r) { return fmtUsd(r.display_implied); }),
            rowFor('TVL', function (r) { return fmtUsd(r.tvl_usd); }),
            rowFor('Category multiple', function (r) { return fmtMult(r.category_multiple); }),
            rowFor('Size adjustment', function (r) { return fmtMult(r.size_multiplier); }),
            rowFor('7-day growth', function (r) { return fmtPct(r.change_7d); }),
            rowFor('Age', function (r) { return fmtAge(r.age_days); }),
            rowFor('Farm cost', function (r) { return '$' + r.farm_cost_usd + ' over ' + r.hold_days + 'd'; })
          )
        )
      ),
      clear
    );
  }

  function excludedTable() {
    var rows = DATA.accounting.excluded_rows;
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { class: 'sub', text: r.reason }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols the board does not rank, each with the rule that sets it aside. A wrapped, staked or bridged product of a token that already trades is not a launch candidate, so it is accounted for here instead of ranked as one.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is set aside' }))),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these ' + DATA.live.length + ' protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market caps are what calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x size_adjustment x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains - 1, 5)) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The category multiple is the median market-cap-to-TVL of the live protocols in that category, taken in log space and shrunk toward the global median (' + DATA.calibration.fallback.toFixed(2) + 'x) with ' + m.calibration_shrink_k + ' pseudo-observations, so a category with one live protocol sits almost at the global median; a category with none uses the global median. The size adjustment is 10 ^ (' + DATA.calibration.size_slope.toFixed(2) + ' x (log10(TVL) - ' + DATA.calibration.size_center.toFixed(2) + ')): big protocols trade at a lower market-cap-to-TVL, so a large TVL is discounted and a small one is marked up, and the effective multiple is clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. A protocol on more chains is worth a little more: each extra chain up to five adds 2%. The early radar is every pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function calibrationPanel() {
    var entries = Object.keys(DATA.calibration.byCategory).map(function (k) {
      return { category: k, multiple: DATA.calibration.byCategory[k].multiple, n: DATA.calibration.byCategory[k].n };
    }).sort(function (a, b) { return b.n - a.n || (a.category < b.category ? -1 : 1); });
    var shown = entries;
    var tbody = el('tbody');
    shown.forEach(function (e) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: e.category })),
        el('td', { class: 'num', text: e.multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: String(e.n) })
      ));
    });
    tbody.appendChild(el('tr', null,
      el('td', null, el('b', { text: 'Fallback (every live protocol)' })),
      el('td', { class: 'num', text: DATA.calibration.fallback.toFixed(2) + 'x' }),
      el('td', { class: 'num', text: 'all' })
    ));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Category calibration, from the live market' }),
      el('p', { class: 'sub', text: 'Each multiple is the median market-cap-to-TVL of the live protocols in that category, taken in log space and shrunk toward the global median with ' + DATA.model.calibration_shrink_k + ' pseudo-observations, computed from this snapshot at run time. All ' + entries.length + ' categories with a live protocol are shown. Each row\u2019s multiple is then adjusted for its own TVL (size slope ' + DATA.calibration.size_slope.toFixed(2) + ' per dex, centred at log10(TVL) ' + DATA.calibration.size_center.toFixed(2) + '), so the table shows the category multiple before that adjustment.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Live protocols' }))),
          tbody
        )
      )
    );
  }

  function validationPanel() {
    var v = DATA.validation;
    var tbody = el('tbody');
    var rowFor = function (label, a, b) {
      return el('tr', null, el('td', null, el('b', { text: label })), el('td', { class: 'num', text: a }), el('td', { class: 'num', text: b }));
    };
    tbody.appendChild(rowFor('Split-half A (fit even, test odd)', v.oos_split_a_log_error.toFixed(4), v.flat_split_a_log_error.toFixed(4)));
    tbody.appendChild(rowFor('Split-half B (fit odd, test even)', v.oos_split_b_log_error.toFixed(4), v.flat_split_b_log_error.toFixed(4)));
    tbody.appendChild(rowFor('Mean of both splits', v.oos_median_log_error.toFixed(4), v.flat_median_log_error.toFixed(4)));
    tbody.appendChild(rowFor('Leave-one-out (n=' + v.loo_n + ')', v.loo_median_log_error.toFixed(4), '—'));
    tbody.appendChild(rowFor('Walk-forward, fit older half, test newer (n=' + v.walk_forward_n_test + ')', v.walk_forward_a_log_error.toFixed(4), v.walk_forward_a_flat_log_error.toFixed(4)));
    tbody.appendChild(rowFor('Walk-forward, fit older 70%, test newest 30%', v.walk_forward_b_log_error.toFixed(4), v.walk_forward_b_flat_log_error.toFixed(4)));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The model, tested before it prices anything' }),
      el('p', { class: 'sub', text: 'Median absolute log error predicting a live protocol\u2019s market cap from its TVL (predicted mcap = TVL x multiple). The fitted multiples are tested out of sample in both split directions against one flat multiple for every category, leave-one-out holds each protocol out of the calibration that prices it, and walk-forward fits on the older protocols and tests on the newer ones, so a model that only works on a random split cannot pass. The fitted model beats the flat baseline by ' + v.improvement_pct + '% on the mean of both splits, so the board keeps it (verdict: ' + (v.kept ? 'kept' : 'not kept') + '). The errors are large in absolute terms — market-cap-to-TVL varies by orders of magnitude — which is why every row also carries a rank range from ' + v.bootstrap_refits + ' bootstrap refits instead of a false-precision point rank.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Test' }), el('th', { scope: 'col', text: 'Fitted multiples' }), el('th', { scope: 'col', text: 'Flat baseline' }))),
          tbody
        )
      )
    );
  }

  function sandboxPanel() {
    var m = DATA.model;
    var sb = state.sandbox || { growth_weight: m.growth_weight, multiple_cap: m.multiple_cap, chain_step: m.chain_step };
    var slider = function (label, key, min, max, step, fmt) {
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(sb[key]), 'aria-label': label });
      var val = el('b', { class: 'num', text: fmt(sb[key]) });
      input.addEventListener('input', function () {
        var next = { growth_weight: sb.growth_weight, multiple_cap: sb.multiple_cap, chain_step: sb.chain_step };
        next[key] = parseFloat(input.value);
        state.sandbox = next;
        render();
      });
      return el('div', { class: 'field' }, el('label', { text: label + ': ' }), input, val);
    };
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the fitted model', onclick: function () { state.sandbox = null; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Move a constant and the board recomputes in place, so you can see what the model choice does to the ranking. The sandbox changes this page only: board.json keeps the fitted model, and the rank column shows the board rank under each row while the sandbox is on.' }),
      el('div', { class: 'controls' },
        slider('Growth weight', 'growth_weight', 0, 1, 0.05, function (v) { return v.toFixed(2); }),
        slider('Multiple cap', 'multiple_cap', 0.5, 2, 0.05, function (v) { return v.toFixed(2) + 'x'; }),
        slider('Chain step', 'chain_step', 0, 0.05, 0.005, function (v) { return v.toFixed(3); }),
        reset
      )
    );
  }

  function coveragePanel() {
    var acc = DATA.accounting;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Coverage: all ' + acc.total + ' protocols accounted for' }),
      el('p', { class: 'sub', text: acc.ranked + ' pre-token protocols are ranked (' + DATA.watchlist_size + ' watchlist, ' + DATA.early_size + ' early below the floor), ' + acc.live + ' protocols already trade and are set aside with their market caps on the Live token tab, and ' + acc.excluded + ' pre-token protocols are set aside on the Set aside tab, each with the rule that sets it aside. Nothing in the snapshot is dropped silently.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = effectiveRows().filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, sandboxModel());
    var shownImplied = state.sandbox ? row.display_implied : row.implied_value_usd;
    var calNote = row.calibration_source === 'category'
      ? 'shrunk log-median of ' + row.calibration_n + ' live ' + (row.category || 'Other') + ' protocols'
      : 'fallback: median of all live protocols';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.display_rank + ' of ' + DATA.board_size + (state.sandbox ? ' (board ' + row.rank + ')' : '') + (WATCHLIST[row.slug] ? ' - Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) + ' (' + calNote + ')' })),
        el('div', null, el('span', { text: 'Size adjustment' }), el('b', { class: 'num', text: fmtMult(row.size_multiplier) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Rank range (' + DATA.validation.bootstrap_refits + ' refits)' }), el('b', { class: 'num', text: row.rank_lo + '–' + row.rank_hi })),
        el('div', null, el('span', { text: 'Farm cost' }), el('b', { class: 'num', text: '$' + row.farm_cost_usd + ' over ' + row.hold_days + ' days' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The rank range is the 10th–90th percentile rank over ' + DATA.validation.bootstrap_refits + ' bootstrap refits of the calibration: rank ' + row.rank + ' holds between ' + row.rank_lo + ' and ' + row.rank_hi + ' under resampling. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === shownImplied ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(boardTable());
      var cmp = comparePanel();
      if (cmp) shell.appendChild(cmp);
      shell.appendChild(sandboxPanel());
      shell.appendChild(validationPanel());
      shell.appendChild(coveragePanel());
      shell.appendChild(modelPanel());
      shell.appendChild(calibrationPanel());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else {
      shell.appendChild(excludedTable());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
