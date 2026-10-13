'use strict';

/* =========================================================
   Weekly Budget — all data lives in this device's localStorage.
   No network calls apart from loading the app files themselves.
   ========================================================= */

const STORE_KEY = 'weeklyBudget.v1';
const DAY = 86400000;

/* ---------- small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const moneyFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const r = Math.round(n * 100) / 100;
  return moneyFmt.format(r === 0 ? 0 : r); // avoid "-$0.00"
}
function moneyShort(n) {
  if (n === null || n === undefined) return '—';
  return Math.abs(n) >= 1000 && Math.round(n) === n ? moneyFmt.format(n).replace('.00', '') : money(n);
}

function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* Dates are stored as local "YYYY-MM-DD" strings. */
function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseYmd(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function today() { return ymd(new Date()); }
function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function mondayOf(s) {
  const d = parseYmd(s);
  const back = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - back);
  return ymd(d);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s) { // 16 Mar 27
  const d = parseYmd(s);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
function fmtDay(s) { // Wed 15
  const d = parseYmd(s);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}`;
}
function fmtWeek(s) { // Mon 13 Oct
  const d = parseYmd(s);
  return `Mon ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function daysBetween(a, b) { // b - a in whole days
  return Math.round((parseYmd(b) - parseYmd(a)) / DAY);
}

/* ---------- state ---------- */

function defaultState() {
  return {
    version: 1,
    settings: { taxRate: null, titheRate: 10, titheBasis: 'gross', offering: true },
    weekStart: mondayOf(today()), // Monday of the "This week" column
    thisWeek: emptyWeek(),
    nextWeek: emptyWeek(),
    costs: [],
    debts: [],
    goals: [],
    history: [],
    lastBackup: null,
  };
}

const OUT_ROWS = ['tax', 'tithe', 'offering', 'fixed', 'living'];

function emptyWeek() {
  return { pay: null, act: { tax: null, tithe: null, offering: null, fixed: null, living: null }, items: {} };
}

function normWeek(w) {
  const out = emptyWeek();
  if (!w) return out;
  out.pay = num(w.pay);
  const act = w.act || {};
  for (const k of OUT_ROWS) out.act[k] = num(act[k]);
  if (w.spent !== undefined && out.act.living === null) out.act.living = num(w.spent); // older format
  for (const [id, v] of Object.entries(w.items || {})) if (num(v) !== null) out.items[id] = num(v);
  return out;
}

function normalise(s) {
  const d = defaultState();
  const out = Object.assign(d, s || {});
  out.settings = Object.assign(defaultState().settings, (s && s.settings) || {});
  out.thisWeek = normWeek(out.thisWeek);
  out.nextWeek = normWeek(out.nextWeek);
  for (const k of ['costs', 'debts', 'goals', 'history']) if (!Array.isArray(out[k])) out[k] = [];
  for (const c of out.costs) if (c.type !== 'living') c.type = 'bill';
  for (const x of [...out.costs, ...out.debts, ...out.goals]) if (!x.id) x.id = uid();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.weekStart || '')) out.weekStart = mondayOf(today());
  return out;
}

let state = load();

// window.__BUDGET_SEED is only set by the local review copy, never in the published app.
function load() {
  const seed = () => (window.__BUDGET_SEED ? normalise(window.__BUDGET_SEED) : defaultState());
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalise(JSON.parse(raw)) : seed();
  } catch (e) {
    return seed();
  }
}

let saveWarned = false;
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    if (!saveWarned) alert('Could not save on this device: ' + e.message);
    saveWarned = true;
  }
}

/* ---------- budget maths ---------- */

const FREQ = {
  weekly: { label: 'Weekly', toWeek: a => a },
  fortnightly: { label: 'Fortnightly', toWeek: a => a / 2 },
  monthly: { label: 'Monthly', toWeek: a => a * 12 / 52 },
  yearly: { label: 'Yearly', toWeek: a => a / 52 },
};

function costPerWeek(c) {
  const f = FREQ[c.freq] || FREQ.weekly;
  return f.toWeek(num(c.amount) || 0);
}

function debtActive(d, weekStart) {
  return d.on !== false && (!d.until || weekStart <= d.until);
}

/* Fixed = bills + debt repayments. Living = the day-to-day allowance. */
function budgetFor(weekStart) {
  let living = 0;
  for (const c of state.costs) if (c.on !== false && c.type === 'living') living += costPerWeek(c);
  const fixed = fixedItems(weekStart).reduce((t, it) => t + it.amount, 0);
  return { fixed, living, total: fixed + living };
}

/* Average weekly cost of bills + debts (for the Expenses summary). */
function fixedAverage(weekStart) {
  let t = 0;
  for (const c of state.costs) if (c.on !== false && c.type !== 'living') t += costPerWeek(c);
  for (const d of state.debts) if (debtActive(d, weekStart)) t += num(d.payment) || 0;
  return t;
}

/* The day a non-weekly bill comes out in a week starting weekStart, or
   false if it doesn't come out that week, or null if it has no date set. */
function dueInWeek(c, weekStart) {
  if (c.freq === 'weekly' || !c.due) return null;
  const anchor = parseYmd(c.due);
  for (let k = 0; k < 7; k++) {
    const day = addDays(weekStart, k);
    const d = parseYmd(day);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const anchorDay = Math.min(anchor.getDate(), dim);
    if (c.freq === 'fortnightly' && ((daysBetween(c.due, day) % 14) + 14) % 14 === 0) return day;
    if (c.freq === 'monthly' && d.getDate() === anchorDay) return day;
    if (c.freq === 'yearly' && d.getMonth() === anchor.getMonth() && d.getDate() === anchorDay) return day;
  }
  return false;
}

/* The bills and debt repayments that come out in a given week.
   Weekly bills: every week. Bills with a "comes out on" date: only in the
   week they're due, at the full amount. Bills without a date: the weekly
   share is set aside every week. */
function fixedItems(weekStart) {
  const items = [];
  for (const c of state.costs) {
    if (c.on === false || c.type === 'living') continue;
    const due = dueInWeek(c, weekStart);
    if (due === false) continue;
    if (due) items.push({ id: c.id, name: c.name || 'Unnamed', amount: num(c.amount) || 0, note: 'due ' + fmtDay(due) });
    else items.push({ id: c.id, name: c.name || 'Unnamed', amount: costPerWeek(c), note: c.freq !== 'weekly' ? 'set aside' : '' });
  }
  for (const d of state.debts) if (debtActive(d, weekStart)) items.push({ id: d.id, name: d.name || 'Unnamed', amount: num(d.payment) || 0, debt: true });
  return items;
}

function snapshot(weekStart) {
  const s = state.settings;
  const b = budgetFor(weekStart);
  return {
    taxRate: num(s.taxRate) || 0,
    titheRate: num(s.titheRate) || 0,
    titheBasis: s.titheBasis,
    offering: !!s.offering,
    fixed: b.fixed,
    living: b.living,
    items: fixedItems(weekStart).map(({ id, amount }) => ({ id, amount })),
  };
}

/* pay: number|null. act: actual amounts per row (null = use expected).
   snap: rates + fixed/living budget.
   exp  = what each row should be, used = actual if entered else expected. */
function calcWeek(pay, act, snap, items) {
  if (pay === null) return null;
  act = Object.assign({}, act || {});
  // Itemised fixed expenses: an actual on any bill/debt line makes the fixed total actual.
  if (items && snap.items && Object.keys(items).length) {
    act.fixed = snap.items.reduce((t, it) => t + (num(items[it.id]) ?? it.amount), 0);
  }
  const exp = {};
  exp.tax = pay * snap.taxRate / 100;
  const titheBase = snap.titheBasis === 'afterTax' ? pay - exp.tax : pay;
  exp.tithe = titheBase * snap.titheRate / 100;
  exp.offering = snap.offering ? pay / 52 : 0;
  exp.fixed = snap.fixed ?? snap.budget ?? 0;
  exp.living = snap.living ?? 0;

  const used = {};
  let anyActual = false;
  for (const k of OUT_ROWS) {
    const a = num(act[k]);
    used[k] = a === null ? exp[k] : a;
    if (a !== null) anyActual = true;
  }
  const sum = o => OUT_ROWS.reduce((t, k) => t + o[k], 0);
  return {
    exp, used,
    liveExp: pay - exp.tax - exp.tithe - exp.offering - exp.fixed,
    liveUsed: pay - used.tax - used.tithe - used.offering - used.fixed,
    available: pay - sum(exp),                 // planned for savings
    saved: pay - sum(used),                    // what's actually left
    diff: anyActual ? sum(exp) - sum(used) : null,
    outUsed: sum(used),
  };
}

/* ---------- savings simulation ----------
   Replays every logged week in date order. Each week's SAVED pours into
   the goals top to bottom: every goal fills to its target (or floor)
   before the next gets anything. Once every goal is at its target, money
   tops up stretch amounts in the same order. Anything beyond that is
   "unallocated". A negative week is taken back from the bottom up.
   Trip goals marked spent drop to zero on their spent date. */
function simulate() {
  const goals = state.goals.map(g => ({
    g, bal: 0, done: false, had: null, shortfall: null,
    target: num(g.target) || 0,
    stretch: num(g.stretch) && num(g.stretch) > (num(g.target) || 0) ? num(g.stretch) : null,
  }));
  let unallocated = 0;

  const events = [];
  for (const h of state.history) events.push({ date: h.weekStart, order: 0, amount: num(h.saved) || 0 });
  goals.forEach((x, i) => { if (x.g.trip && x.g.spentOn) events.push({ date: x.g.spentOn, order: 1, spend: i }); });
  events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order);

  for (const e of events) {
    if (e.spend !== undefined) {
      const x = goals[e.spend];
      x.had = x.bal;
      x.shortfall = Math.max(0, x.target - x.bal);
      x.bal = 0;
      x.done = true;
      continue;
    }
    let amt = e.amount;
    if (amt >= 0) {
      for (const x of goals) {
        if (x.done || amt <= 0) continue;
        const room = Math.max(0, x.target - x.bal);
        const put = Math.min(room, amt);
        x.bal += put; amt -= put;
      }
      for (const x of goals) {
        if (x.done || !x.stretch || amt <= 0) continue;
        const room = Math.max(0, x.stretch - x.bal);
        const put = Math.min(room, amt);
        x.bal += put; amt -= put;
      }
      unallocated += amt;
    } else {
      let need = -amt;
      const fromSpare = Math.min(Math.max(0, unallocated), need);
      unallocated -= fromSpare; need -= fromSpare;
      for (let i = goals.length - 1; i >= 0 && need > 0; i--) {
        const x = goals[i];
        if (x.done) continue;
        const take = Math.min(x.bal, need);
        x.bal -= take; need -= take;
      }
      unallocated -= need;
    }
  }
  return { goals, unallocated };
}

function currentGoal(sim) {
  const open = sim.goals.filter(x => !x.done && x.target > 0);
  return open.find(x => x.bal < x.target - 0.005)
      || open.find(x => x.stretch && x.bal < x.stretch - 0.005)
      || null;
}

/* ---------- rendering: This Week ---------- */

const colState = { this: () => state.thisWeek, next: () => state.nextWeek };
const colStart = { this: () => state.weekStart, next: () => addDays(state.weekStart, 7) };

const ROW_LABEL = { tax: 'Tax', tithe: 'Tithe', offering: 'Offering', fixed: 'Fixed expenses', living: 'Living expenses' };

function weekCardHtml(key, items) {
  const row = k => `
    <tr data-row="${k}">
      <th>${ROW_LABEL[k]}</th>
      <td data-exp="${k}"></td>
      <td><input type="text" inputmode="decimal" data-act="${k}" autocomplete="off" aria-label="${ROW_LABEL[k]} actual"></td>
    </tr>`;
  return `
    <div class="wk" data-col="${key}" data-sig="${esc(weekSig(items))}">
      <div class="wk-head">
        <h2>${key === 'this' ? 'This week' : 'Next week'}</h2>
        <span class="when" data-out="start"></span>
      </div>
      <label class="field pay">
        <span>Came in (my pay)</span>
        <input type="text" inputmode="decimal" data-in="pay" placeholder="0.00" autocomplete="off">
      </label>
      <table class="plan">
        <thead><tr><th></th><th>Expected</th><th>Actual</th></tr></thead>
        <tbody>
          ${row('tax')}${row('tithe')}${row('offering')}
          <tr class="group"><th>Fixed expenses</th><td data-exp="fixed"></td><td data-out="fixedUsed"></td></tr>
          ${items.map(it => `
          <tr class="item-row">
            <th>${esc(it.name)}${it.note ? `<small>${it.note}</small>` : ''}</th>
            <td>${money(it.amount)}</td>
            <td><input type="text" inputmode="decimal" data-item="${esc(it.id)}" autocomplete="off" placeholder="${(Math.round(it.amount * 100) / 100).toFixed(2)}" aria-label="${esc(it.name)} actual"></td>
          </tr>`).join('') || '<tr class="item-row"><th colspan="3">Nothing due this week</th></tr>'}
          <tr class="sub"><th>Yours to live on</th><td data-out="liveExp"></td><td data-out="liveUsed"></td></tr>
          ${row('living')}
          <tr class="diff-row"><th>Under / over</th><td colspan="2" data-out="diff"></td></tr>
          <tr class="sub"><th>Available for savings</th><td data-out="available"></td><td></td></tr>
        </tbody>
      </table>
      <div class="saved">
        <span>SAVED</span>
        <strong data-out="saved"></strong>
        <small data-out="savedNote"></small>
      </div>
    </div>`;
}

function weekSig(items) {
  return items.map(it => it.id + ':' + it.name + ':' + it.amount).join('|');
}

function renderWeek() {
  const host = $('#weeks');
  if (!host.children.length) host.innerHTML = '<div data-col="this"></div><div data-col="next"></div>';

  for (const key of ['this', 'next']) {
    const wk = colState[key]();
    const start = colStart[key]();
    const items = fixedItems(start);
    let root = $(`#weeks > [data-col="${key}"]`);
    if (root.dataset.sig !== weekSig(items)) { // bills/debts changed: rebuild this card
      root.outerHTML = weekCardHtml(key, items);
      root = $(`#weeks > [data-col="${key}"]`);
    }
    const snap = snapshot(start);
    const r = calcWeek(wk.pay, wk.act, snap, wk.items);
    for (const inp of $$('[data-item]', root)) {
      const a = wk.items[inp.dataset.item];
      if (document.activeElement !== inp) inp.value = a === undefined || a === null ? '' : a;
      const it = items.find(x => x.id === inp.dataset.item);
      inp.classList.remove('over', 'under');
      if (a != null && it && Math.abs(a - it.amount) > 0.005) inp.classList.add(a > it.amount ? 'over' : 'under');
    }
    const fu = $('[data-out="fixedUsed"]', root);
    fu.textContent = r ? money(r.used.fixed) : '';
    fu.classList.toggle('changed', !!(r && Math.abs(r.used.fixed - r.exp.fixed) > 0.005));
    const out = name => $(`[data-out="${name}"]`, root);
    const plain = n => (Math.round(n * 100) / 100).toFixed(2);

    out('start').textContent = 'Starting ' + fmtWeek(start);
    const payIn = $('[data-in="pay"]', root);
    if (document.activeElement !== payIn) payIn.value = wk.pay === null ? '' : wk.pay;

    $('[data-row="offering"]', root).hidden = !state.settings.offering;
    for (const k of OUT_ROWS) {
      if (k === 'fixed') { $('[data-exp="fixed"]', root).textContent = money(r ? r.exp.fixed : snap.fixed); continue; }
      const exp = r ? r.exp[k] : (k === 'fixed' ? snap.fixed : k === 'living' ? snap.living : null);
      $(`[data-exp="${k}"]`, root).textContent = exp === null ? '—' : money(exp);
      const input = $(`[data-act="${k}"]`, root);
      const a = wk.act[k];
      if (document.activeElement !== input) input.value = a === null ? '' : a;
      input.placeholder = exp === null ? '—' : plain(exp);
      input.classList.remove('over', 'under');
      if (a !== null && exp !== null && Math.abs(a - exp) > 0.005) input.classList.add(a > exp ? 'over' : 'under');
    }

    out('liveExp').textContent = r ? money(r.liveExp) : '—';
    out('liveUsed').textContent = r ? money(r.liveUsed) : '—';
    out('available').textContent = r ? money(r.available) : '—';

    const diff = out('diff');
    diff.className = '';
    if (r && r.diff !== null) {
      diff.textContent = Math.abs(r.diff) < 0.005 ? 'On budget' : (r.diff > 0 ? 'Under by ' : 'Over by ') + money(Math.abs(r.diff));
      diff.classList.add(r.diff >= 0 ? 'good' : 'bad');
    } else {
      diff.textContent = 'Enter actuals to compare';
      diff.classList.add('muted');
    }

    const savedBox = out('saved').parentElement;
    savedBox.classList.remove('good', 'bad');
    out('saved').textContent = r ? money(r.saved) : '—';
    out('savedNote').textContent = !r ? 'Enter pay to see it'
      : r.diff === null ? 'Based on expected amounts' : 'Pay minus what actually went out';
    if (r) savedBox.classList.add(r.saved >= 0 ? 'good' : 'bad');
  }

  // Tax rate not set yet
  const warn = $('#week-warning');
  const msgs = [];
  if (num(state.settings.taxRate) === null) msgs.push('Tax % isn’t set yet — add it in <a href="#settings">Settings</a>.');
  const nowMonday = mondayOf(today());
  if (nowMonday > state.weekStart) {
    msgs.push(`“This week” is still the week of ${fmtWeek(state.weekStart)}. When it’s finished, tap <b>Start new week</b>.`);
  }
  warn.innerHTML = msgs.join('<br>');
  warn.hidden = msgs.length === 0;

  // Savings goals progress
  const sim = simulate();
  const cur = currentGoal(sim);
  const open = sim.goals.filter(x => !x.done);
  $('#home-goals').innerHTML = !state.goals.length
    ? '<p class="hint">No goals yet — add them in <a href="#settings">Settings</a>.</p>'
    : open.map(x => {
        const top = x.target || 1;
        const pct = Math.min(100, Math.round(x.bal / top * 100));
        return `
        <div class="mini-goal ${cur === x ? 'current' : ''}">
          <div class="mini-head">
            <span>${esc(x.g.name) || 'Unnamed goal'}${cur === x ? ' <em>← next $ goes here</em>' : ''}</span>
            <strong>${pct}%</strong>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <small>${money(x.bal)} of ${money(x.target)}</small>
        </div>`;
      }).join('') + (cur ? '' : '<p class="hint">All goals are full.</p>');

  // Fixed costs list, split into bills and living
  const costRow = (c, i) => `
    <li class="${c.on === false ? 'off' : ''}">
      <span class="name">${esc(c.name) || 'Unnamed'}${c.freq && c.freq !== 'weekly' ? `<small>${money(num(c.amount))} ${FREQ[c.freq].label.toLowerCase()}${c.type !== 'living' ? (c.due ? ' · from ' + fmtDate(c.due) : ' · no date, set aside weekly') : ''}</small>` : ''}</span>
      <span class="amt">${money(costPerWeek(c))}</span>
      <input type="checkbox" class="switch" data-toggle="costs" data-idx="${i}" ${c.on !== false ? 'checked' : ''} aria-label="Include ${esc(c.name)}">
    </li>`;
  const listOf = type => state.costs.map((c, i) => [c, i]).filter(([c]) => (c.type === 'living') === (type === 'living'));
  const bills = listOf('bill'), living = listOf('living');
  $('#cost-list').innerHTML = bills.length ? bills.map(([c, i]) => costRow(c, i)).join('') : '<li class="empty">No bills yet</li>';
  $('#living-list').innerHTML = living.length ? living.map(([c, i]) => costRow(c, i)).join('') : '<li class="empty">No living expenses yet</li>';

  const debtList = $('#debt-list');
  debtList.innerHTML = state.debts.length ? state.debts.map((d, i) => {
    const expired = d.until && state.weekStart > d.until;
    const sub = [num(d.balance) !== null ? `Balance ${money(num(d.balance))}` : '', expired ? 'paid off' : ''].filter(Boolean).join(' · ');
    return `
    <li class="${d.on === false || expired ? 'off' : ''}">
      <span class="name">${esc(d.name) || 'Unnamed'}${d.until ? ` (until ${fmtDate(d.until)})` : ''}${sub ? `<small>${sub}</small>` : ''}</span>
      <span class="amt">${money(num(d.payment) || 0)}</span>
      <input type="checkbox" class="switch" data-toggle="debts" data-idx="${i}" ${d.on !== false ? 'checked' : ''} aria-label="Include ${esc(d.name)}">
    </li>`;
  }).join('') : '<li class="empty">No debts</li>';

  const b = budgetFor(state.weekStart);
  const fixedAvg = fixedAverage(state.weekStart);
  $('#fixed-total').textContent = money(fixedAvg);
  $('#living-total').textContent = money(b.living);
  $('#budget-total').textContent = money(fixedAvg + b.living);
  $('#budget-total-summary').textContent = money(fixedAvg + b.living) + '/wk avg';
}

/* ---------- rendering: Savings ---------- */

function renderSavings() {
  const sim = simulate();
  const cur = currentGoal(sim);
  const t = today();

  const goalHtml = sim.goals.map(x => {
    const g = x.g;
    const top = x.stretch || x.target;
    const pctFloor = x.target ? Math.min(100, x.bal / x.target * 100) : 0;
    const pctBar = top ? Math.min(100, x.bal / top * 100) : 0;
    const floorMark = x.stretch ? (x.target / x.stretch * 100) : null;

    let need = '';
    if (!x.done && g.date) {
      const days = daysBetween(t, g.date);
      if (days <= 0) {
        need = x.bal >= x.target ? '' : 'Date passed';
      } else {
        const weeks = Math.max(1, Math.ceil(days / 7));
        const perWk = Math.max(0, x.target - x.bal) / weeks;
        need = perWk > 0 ? `${money(perWk)}/wk needed` : 'On target';
        if (x.stretch && x.bal < x.stretch) need += ` · ${money((x.stretch - x.bal) / weeks)}/wk for stretch`;
      }
    }

    let tag = '';
    if (x.done) tag = '<span class="tag">spent</span>';
    else if (x.target && x.bal >= x.target - 0.005) tag = '<span class="tag done">full</span>';
    if (g.trip && !x.done) tag += '<span class="tag">trip</span>';

    let spentNote = '';
    if (x.done) {
      spentNote = `<div class="spent-note">Spent ${fmtDate(g.spentOn)} — had ${money(x.had)} of ${money(x.target)}${x.shortfall > 0.005 ? ` · <span class="bad">short ${money(x.shortfall)}</span>` : ' · <span class="good">fully funded</span>'}</div>`;
    }

    const btn = g.trip
      ? (g.spentOn
          ? `<button class="btn small" data-unspend="${g.id}">Undo spent</button>`
          : `<button class="btn small" data-spend="${g.id}">Mark spent</button>`)
      : '';

    return `
      <div class="goal ${cur === x ? 'current' : ''}">
        <div class="goal-head">
          <strong>${esc(g.name) || 'Unnamed goal'}${tag}</strong>
          <span class="pct">${x.done ? '' : Math.round(pctFloor) + '%'}</span>
        </div>
        <div class="bar">
          <i style="width:${x.done ? 0 : pctBar}%" class="${x.stretch && x.bal > x.target ? 'stretch' : ''}"></i>
          ${x.stretch && x.bal > x.target && !x.done ? `<i style="width:${floorMark}%"></i>` : ''}
          ${floorMark ? `<b style="left:${floorMark}%"></b>` : ''}
        </div>
        <div class="goal-meta">
          <span><span class="money">${money(x.bal)}</span> of ${money(x.target)}${x.stretch ? ` (stretch ${moneyShort(x.stretch)})` : ''}</span>
          <span>${g.date ? 'by ' + fmtDate(g.date) : 'no date'}</span>
        </div>
        ${need ? `<div class="goal-meta"><span>${need}</span></div>` : ''}
        ${spentNote}
        ${btn}
      </div>`;
  }).join('');
  $('#goal-list').innerHTML = goalHtml || '<div class="note">No goals yet. Add them in <a href="#settings">Settings</a>.</div>';

  const un = $('#unallocated');
  if (Math.abs(sim.unallocated) > 0.005) {
    un.hidden = false;
    un.innerHTML = sim.unallocated > 0
      ? `Unallocated (all goals full): <b>${money(sim.unallocated)}</b>`
      : `Overspent beyond savings: <b class="bad">${money(sim.unallocated)}</b>`;
  } else un.hidden = true;

  // Stats
  const hist = sortedHistory();
  const totalSaved = hist.reduce((a, h) => a + (num(h.saved) || 0), 0);
  const inGoals = sim.goals.reduce((a, x) => a + x.bal, 0) + sim.unallocated;
  $('#stat-total').textContent = money(totalSaved);
  $('#stat-total-sub').textContent = Math.abs(inGoals - totalSaved) > 0.005 ? `${money(inGoals)} held now` : '';

  for (const n of [4, 12]) {
    const rows = hist.filter(h => num(h.pay) !== null).slice(0, n);
    const avg = rows.length ? rows.reduce((a, h) => a + num(h.pay), 0) / rows.length : null;
    $(`#stat-avg${n}`).textContent = money(avg);
    $(`#stat-avg${n}-sub`).textContent = rows.length && rows.length < n ? `from ${rows.length} wk${rows.length > 1 ? 's' : ''}` : '';
  }

  // History
  $('#history').innerHTML = hist.length ? `
    <div class="hist"><table>
      <thead><tr><th>Week</th><th>Came in</th><th>Went out</th><th>Saved</th></tr></thead>
      <tbody>${hist.map(h => `
        <tr data-hist="${h.id}">
          <td>${fmtDate(h.weekStart)}</td>
          <td>${money(num(h.pay))}</td>
          <td>${money(histOut(h))}</td>
          <td class="${num(h.saved) >= 0 ? 'good' : 'bad'}">${money(num(h.saved))}</td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="hist"><div class="empty">No finished weeks yet. Tap “Start new week” on the home screen when a week is done.</div></div>';
}

// Total that went out in a logged week (older rows may lack it).
function histOut(h) {
  if (typeof h.out === 'number') return h.out;
  return (num(h.pay) || 0) - (num(h.saved) || 0);
}

function sortedHistory() {
  return state.history.slice().sort((a, b) => a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0);
}

/* ---------- rendering: Settings ---------- */

function renderSettings() {
  const s = state.settings;
  const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v ?? ''; };
  setVal('#set-tax', s.taxRate);
  setVal('#set-tithe', s.titheRate);
  $('#set-tithe-basis').value = s.titheBasis;
  $('#set-offering').checked = !!s.offering;

  const actions = (list, i, extra = '') => `
    <div class="item-actions">
      <button class="btn icon" data-move="${list}" data-idx="${i}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn icon" data-move="${list}" data-idx="${i}" data-dir="1" aria-label="Move down" ${i === state[list].length - 1 ? 'disabled' : ''}>↓</button>
      <span class="spacer"></span>
      ${extra}
      <button class="btn icon danger" data-del="${list}" data-idx="${i}" aria-label="Delete">✕</button>
    </div>`;

  const field = (list, i, key, label, val, opts = {}) => `
    <label class="${opts.full ? 'full' : ''}">
      <span>${label}</span>
      <input type="${opts.type || 'text'}" ${opts.type ? '' : 'inputmode="' + (opts.text ? 'text' : 'decimal') + '"'} data-list="${list}" data-idx="${i}" data-k="${key}" value="${esc(val ?? '')}" placeholder="${opts.ph || ''}" autocomplete="off">
    </label>`;
  const toggle = (list, i, key, label, on) => `
    <label class="check full">
      <input type="checkbox" class="switch" data-list="${list}" data-idx="${i}" data-k="${key}" ${on ? 'checked' : ''}>
      <span>${label}</span>
    </label>`;

  $('#edit-costs').innerHTML = state.costs.map((c, i) => `
    <div class="item ${c.on === false ? 'off' : ''}">
      <div class="item-grid">
        ${field('costs', i, 'name', 'Name', c.name, { full: true, text: true, ph: 'e.g. Phone' })}
        ${field('costs', i, 'amount', 'Amount', c.amount, { ph: '0.00' })}
        <label><span>How often</span>
          <select data-list="costs" data-idx="${i}" data-k="freq">
            ${Object.entries(FREQ).map(([k, f]) => `<option value="${k}" ${c.freq === k ? 'selected' : ''}>${f.label}</option>`).join('')}
          </select>
        </label>
        ${c.type !== 'living' && c.freq !== 'weekly' ? field('costs', i, 'due', 'Comes out on (a recent or next date)', c.due, { type: 'date', full: true }) : ''}
        <label class="full"><span>Type</span>
          <select data-list="costs" data-idx="${i}" data-k="type">
            <option value="bill" ${c.type !== 'living' ? 'selected' : ''}>Bill — fixed expense</option>
            <option value="living" ${c.type === 'living' ? 'selected' : ''}>Living — day-to-day allowance</option>
          </select>
        </label>
        ${toggle('costs', i, 'on', 'Included in budget', c.on !== false)}
      </div>
      ${actions('costs', i, `<span class="per-week" data-perweek="${i}">${money(costPerWeek(c))}/wk</span>`)}
    </div>`).join('') || '<p class="hint">None yet.</p>';

  $('#edit-debts').innerHTML = state.debts.map((d, i) => `
    <div class="item ${d.on === false ? 'off' : ''}">
      <div class="item-grid">
        ${field('debts', i, 'name', 'Name', d.name, { full: true, text: true, ph: 'e.g. Car loan' })}
        ${field('debts', i, 'balance', 'Balance', d.balance, { ph: '0.00' })}
        ${field('debts', i, 'payment', 'Weekly payment', d.payment, { ph: '0.00' })}
        ${field('debts', i, 'until', 'Paid off by (optional)', d.until, { type: 'date', full: true })}
        ${toggle('debts', i, 'on', 'Included in budget', d.on !== false)}
      </div>
      ${actions('debts', i)}
    </div>`).join('') || '<p class="hint">None yet.</p>';

  $('#edit-goals').innerHTML = state.goals.map((g, i) => `
    <div class="item">
      <div class="item-grid">
        ${field('goals', i, 'name', `${i + 1}. Name`, g.name, { full: true, text: true, ph: 'e.g. Holiday' })}
        ${field('goals', i, 'target', 'Target (or floor)', g.target, { ph: '0.00' })}
        ${field('goals', i, 'stretch', 'Stretch (optional)', g.stretch, { ph: '—' })}
        ${field('goals', i, 'date', 'Target date (optional)', g.date, { type: 'date', full: true })}
        ${toggle('goals', i, 'trip', 'Trip — gets spent on its date', !!g.trip)}
      </div>
      ${actions('goals', i)}
    </div>`).join('') || '<p class="hint">None yet.</p>';

  const b = state.lastBackup;
  $('#backup-status').textContent = b
    ? `Last exported ${fmtDate(b.slice(0, 10))} (${daysBetween(b.slice(0, 10), today())} days ago).`
    : 'Not backed up yet. Export a copy now and then — if you clear Safari/Chrome data, the app’s data goes with it.';
}

/* ---------- routing ---------- */

function route() {
  const tab = (location.hash || '#week').slice(1);
  const name = ['week', 'savings', 'settings'].includes(tab) ? tab : 'week';
  for (const s of $$('.screen')) s.hidden = s.id !== 'screen-' + name;
  for (const a of $$('.tabs a')) a.classList.toggle('active', a.dataset.tab === name);
  $('#title').textContent = $('#screen-' + name).dataset.title;
  renderAll();
  window.scrollTo(0, 0);
}

function renderAll() {
  renderWeek();
  if (!$('#screen-savings').hidden) renderSavings();
  if (!$('#screen-settings').hidden) renderSettings();
}

/* ---------- dialog ---------- */

function openDialog({ title, body, ok = 'OK', okClass = 'primary', extra = '' }) {
  const dlg = $('#dialog');
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  const okBtn = $('#dialog-ok');
  okBtn.textContent = ok;
  okBtn.className = 'btn ' + okClass;
  $$('.extra', dlg).forEach(e => e.remove());
  if (extra) okBtn.insertAdjacentHTML('beforebegin', extra);
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
  });
}

/* ---------- events: This Week ---------- */

document.addEventListener('input', e => {
  const el = e.target;

  // Home screen: pay and actual amounts
  const card = el.closest('.wk');
  if (card && (el.dataset.in || el.dataset.act || el.dataset.item)) {
    const wk = colState[card.dataset.col]();
    if (el.dataset.in) wk.pay = num(el.value);
    else if (el.dataset.item) {
      if (num(el.value) === null) delete wk.items[el.dataset.item];
      else wk.items[el.dataset.item] = num(el.value);
    } else wk.act[el.dataset.act] = num(el.value);
    save();
    renderWeek();
    return;
  }

  // Settings rates
  if (el.id === 'set-tax') { state.settings.taxRate = num(el.value); save(); renderWeek(); return; }
  if (el.id === 'set-tithe') { state.settings.titheRate = num(el.value); save(); renderWeek(); return; }

  // Settings list editors
  if (el.dataset.list) {
    const item = state[el.dataset.list][+el.dataset.idx];
    const k = el.dataset.k;
    if (el.type === 'checkbox') item[k] = el.checked;
    else if (['amount', 'balance', 'payment', 'target', 'stretch'].includes(k)) item[k] = num(el.value);
    else item[k] = el.value || (k === 'name' ? '' : null);
    if (el.dataset.list === 'goals' && k === 'trip' && !el.checked) item.spentOn = null;
    save();
    if (el.type === 'checkbox') el.closest('.item').classList.toggle('off', k === 'on' && !el.checked);
    if (el.dataset.list === 'costs') {
      const pw = $(`[data-perweek="${el.dataset.idx}"]`);
      if (pw) pw.textContent = money(costPerWeek(item)) + '/wk';
    }
    renderWeek();
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.toggle) { // on/off switches on the home screen
    state[el.dataset.toggle][+el.dataset.idx].on = el.checked;
    save();
    renderWeek();
    return;
  }
  if (el.id === 'set-tithe-basis') { state.settings.titheBasis = el.value; save(); renderWeek(); return; }
  if (el.id === 'set-offering') { state.settings.offering = el.checked; save(); renderWeek(); return; }
  if (el.dataset.list && el.tagName === 'SELECT') {
    state[el.dataset.list][+el.dataset.idx][el.dataset.k] = el.value;
    save();
    renderAll();
  }
});

$('#new-week').addEventListener('click', async () => {
  const wk = state.thisWeek;
  if (wk.pay === null) {
    await openDialog({ title: 'Enter this week’s pay first', body: '<p>Type what came in this week (put 0 if nothing did), then tap Start new week again.</p>', ok: 'OK' });
    return;
  }
  const snap = snapshot(state.weekStart);
  const r = calcWeek(wk.pay, wk.act, snap, wk.items);
  const res = await openDialog({
    title: 'Start new week?',
    body: `<p>This logs the week of <b>${fmtDate(state.weekStart)}</b> to history:</p>
      <p>Came in ${money(wk.pay)} · Went out ${money(r.outUsed)} · Saved <b class="${r.saved >= 0 ? 'good' : 'bad'}">${money(r.saved)}</b></p>
      ${r.diff === null ? '<p class="hint">No actuals entered, so expected amounts are used.</p>' : ''}
      <p>Next week moves into This week.</p>`,
    ok: 'Start new week',
  });
  if (res !== 'ok') return;
  const act = {};
  for (const k of OUT_ROWS) act[k] = round2(r.used[k]);
  state.history.push({ id: uid(), weekStart: state.weekStart, pay: wk.pay, act, items: Object.assign({}, wk.items), out: round2(r.outUsed), saved: round2(r.saved), snap });
  state.thisWeek = normWeek(state.nextWeek);
  state.nextWeek = emptyWeek();
  state.weekStart = addDays(state.weekStart, 7);
  save();
  renderAll();
});

function round2(n) { return Math.round(n * 100) / 100; }

/* ---------- events: Savings ---------- */

document.addEventListener('click', async e => {
  const t = e.target.closest('button, tr[data-hist]');
  if (!t) return;

  if (t.dataset.spend) {
    const g = state.goals.find(x => x.id === t.dataset.spend);
    const def = g.date && g.date <= today() ? g.date : today();
    const res = await openDialog({
      title: `Mark “${g.name || 'trip'}” spent`,
      body: `<p>Its balance resets to zero on this date and any shortfall is shown.</p>
        <label class="field"><span>Spent on</span><input type="date" id="dlg-date" value="${def}"></label>`,
      ok: 'Mark spent',
    });
    if (res !== 'ok') return;
    g.spentOn = $('#dlg-date').value || def;
    save(); renderAll();
    return;
  }
  if (t.dataset.unspend) {
    const g = state.goals.find(x => x.id === t.dataset.unspend);
    g.spentOn = null;
    save(); renderAll();
    return;
  }

  if (t.dataset.hist) { editHistory(t.dataset.hist); return; }

  // Settings: reorder / delete / add
  if (t.dataset.move) {
    const list = state[t.dataset.move];
    const i = +t.dataset.idx, j = i + +t.dataset.dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(); renderAll();
    return;
  }
  if (t.dataset.del) {
    const list = state[t.dataset.del];
    const item = list[+t.dataset.idx];
    const res = await openDialog({ title: 'Delete?', body: `<p>Delete “${esc(item.name) || 'this item'}”?</p>`, ok: 'Delete', okClass: 'danger' });
    if (res !== 'ok') return;
    list.splice(+t.dataset.idx, 1);
    save(); renderAll();
    return;
  }
  if (t.dataset.add) {
    const add = {
      cost: () => state.costs.push({ id: uid(), name: '', amount: null, freq: 'weekly', type: 'bill', on: true }),
      debt: () => state.debts.push({ id: uid(), name: '', balance: null, payment: null, until: null, on: true }),
      goal: () => state.goals.push({ id: uid(), name: '', target: null, stretch: null, date: null, trip: false, spentOn: null }),
    }[t.dataset.add];
    add();
    save(); renderAll();
    const items = $$(`#edit-${t.dataset.add}s .item`);
    const last = items[items.length - 1];
    if (last) { last.scrollIntoView({ block: 'center' }); $('input', last).focus(); }
  }
});

async function editHistory(id) {
  const h = state.history.find(x => x.id === id);
  const isNew = !h;
  const row = h || {
    id: uid(), weekStart: addDays(state.history.length ? sortedHistory().slice(-1)[0].weekStart : state.weekStart, -7),
    pay: null, act: null, saved: 0, snap: null,
  };
  const snap = row.snap || snapshot(row.weekStart);
  // What went out on each line: stored actuals, or expected amounts for older/new rows.
  let used;
  if (row.act && OUT_ROWS.every(k => num(row.act[k]) !== null)) used = row.act;
  else {
    const r = calcWeek(num(row.pay) || 0, row.act || (row.spent != null ? { living: row.spent } : {}), snap);
    used = r.used;
  }
  const field = (k, label) => `<label class="field"><span>${label}</span><input type="text" inputmode="decimal" id="h-${k}" value="${row.pay === null ? '' : round2(used[k])}" placeholder="0.00"></label>`;
  const res = await openDialog({
    title: isNew ? 'Add a past week' : 'Edit week',
    body: `
      <label class="field"><span>Week starting (Monday)</span><input type="date" id="h-week" value="${row.weekStart}"></label>
      <label class="field"><span>Came in</span><input type="text" inputmode="decimal" id="h-pay" value="${row.pay ?? ''}" placeholder="0.00"></label>
      <p class="hint">What actually went out:</p>
      <div class="dlg-grid">
        ${field('tax', 'Tax')}${field('tithe', 'Tithe')}${field('offering', 'Offering')}${field('fixed', 'Fixed expenses')}${field('living', 'Living expenses')}
      </div>
      <p class="hint">Saved = came in − everything that went out.${isNew ? ' Blank lines use the expected amounts from Settings.' : ''}</p>`,
    ok: 'Save',
    extra: isNew ? '' : '<button class="btn danger extra" value="delete" type="submit" formnovalidate>Delete</button>',
  });

  if (res === 'delete') {
    const sure = await openDialog({ title: 'Delete this week?', body: `<p>Week of ${fmtDate(row.weekStart)} will be removed and goal totals recalculated.</p>`, ok: 'Delete', okClass: 'danger' });
    if (sure === 'ok') {
      state.history = state.history.filter(x => x.id !== id);
      save(); renderAll();
    }
    return;
  }
  if (res !== 'ok') return;

  const weekStart = $('#h-week').value ? mondayOf($('#h-week').value) : row.weekStart;
  const pay = num($('#h-pay').value) ?? 0;
  const entered = {};
  for (const k of OUT_ROWS) entered[k] = num($('#h-' + k).value);
  const r = calcWeek(pay, entered, snap);
  const act = {};
  for (const k of OUT_ROWS) act[k] = round2(r.used[k]);
  delete row.spent;
  Object.assign(row, { weekStart, pay, act, out: round2(r.outUsed), saved: round2(r.saved), snap });
  if (isNew) state.history.push(row);
  save(); renderAll();
}

$('#add-past').addEventListener('click', () => editHistory(null));

/* ---------- backup ---------- */

$('#export').addEventListener('click', async () => {
  const json = JSON.stringify(state, null, 2);
  const name = `weekly-budget-backup-${today()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Weekly Budget backup' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    state.lastBackup = today();
    save(); renderSettings();
  } catch (err) {
    if (err && err.name !== 'AbortError') alert('Export failed: ' + err.message);
  }
});

$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try {
    data = JSON.parse(await f.text());
    if (!data || typeof data !== 'object' || !data.settings || !Array.isArray(data.history)) throw new Error('Not a Weekly Budget backup file.');
  } catch (err) {
    await openDialog({ title: 'Can’t import', body: `<p>${esc(err.message)}</p>` });
    return;
  }
  const res = await openDialog({
    title: 'Replace everything?',
    body: `<p>This replaces all data on this device with the backup (${data.history.length} logged weeks, ${(data.goals || []).length} goals).</p>`,
    ok: 'Import', okClass: 'danger',
  });
  if (res !== 'ok') return;
  state = normalise(data);
  save(); renderAll();
});

$('#clear').addEventListener('click', async () => {
  const res = await openDialog({
    title: 'Clear all data?',
    body: '<p>This deletes every number, item, goal and logged week on this device. It can’t be undone.</p><p>Export a backup first if you might want it back.</p><label class="field"><span>Type CLEAR to confirm</span><input type="text" id="dlg-confirm" autocomplete="off" autocapitalize="characters"></label>',
    ok: 'Clear everything', okClass: 'danger',
  });
  if (res !== 'ok') return;
  if (($('#dlg-confirm').value || '').trim().toUpperCase() !== 'CLEAR') {
    await openDialog({ title: 'Not cleared', body: '<p>Nothing was deleted.</p>' });
    return;
  }
  state = defaultState();
  save(); renderAll();
});

/* ---------- start ---------- */

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });
route();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Exposed for tests only.
if (typeof window !== 'undefined') window.__budget = { calcWeek, dueInWeek, fixedItems, simulate, costPerWeek, budgetFor, mondayOf, getState: () => state, setState: s => { state = normalise(s); } };
