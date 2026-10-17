'use strict';

/* =========================================================
   Helpers
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const dateOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
const mondayOf = s => { const d = dateOf(s); return addDays(s, -((d.getDay() + 6) % 7)); };
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICONS[name] || ICONS.circle}</svg>`;
const num = n => Math.round(n).toLocaleString('ru-RU');
const dec = (n, d = 1) => (+n).toLocaleString('ru-RU', { maximumFractionDigits: d });
const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return f[a > 10 && a < 20 ? 2 : b > 1 && b < 5 ? 1 : b === 1 ? 0 : 2]; };
const DAYS = ['день', 'дня', 'дней'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const shortDate = s => { const d = dateOf(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const wdDate = s => `${WD[dateOf(s).getDay()]}, ${shortDate(s)}`;
const clone = o => JSON.parse(JSON.stringify(o));

/* =========================================================
   State
   ========================================================= */
const KEY = 'quest.v1';

function fresh() {
  return {
    v: 1,
    profile: { name: '', goal: 'Middle Go Backend в inDrive', deadline: '2027-09-30', day1: today(), nextSprint: 1, onboarded: false },
    days: {},       // 'YYYY-MM-DD' → { rating, sleep, bed, acts: {id: true|minutes}, studied, pleasant, annoying, tags }
    lc: [],         // { id, date, diff: E|M|H, topic, title, morning }
    sprints: [],    // { id, n, start, goals: [{id, type, text, target, done}], retro, closed, result: {pct} }
    feynman: [],    // { id, n, date, topic, problem, solution, nuance, where, question, tags, node, exam }
    tree: {},       // nodeId → { s, f, a }
    activities: clone(DEFAULT_ACTIVITIES),
    rewards: clone(DEFAULT_REWARDS),
    purchases: [],  // { id, reward, name, cost, date }
    achSeen: {},    // achievementId → date first unlocked
    lastBackup: null,
  };
}
const valid = d => d && d.profile && d.days && Array.isArray(d.lc) && Array.isArray(d.sprints);

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (valid(d)) return d; } catch (e) { /* ignore */ }
  return null;
}
function normalize(d) {
  const f = fresh();
  for (const k of Object.keys(f)) if (d[k] === undefined) d[k] = f[k];
  d.profile = { ...f.profile, ...d.profile };
  return d;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Не удалось сохранить данные'); }
}

let S = normalize(load() || fresh());
save();
navigator.storage?.persist?.().catch(() => {});

function snapshot() {
  const snap = JSON.stringify(S);
  return () => { S = JSON.parse(snap); save(); if (!sheetRoot.hidden) closeSheet(); render(); };
}

const UI = { tab: 'today', journal: 14 };

/* =========================================================
   Game rules (everything is derived from the records, so edits and undo stay consistent)
   ========================================================= */
const actById = id => S.activities.find(a => a.id === id);
const dayN = s => dayDiff(S.profile.day1, s) + 1;

// Sleep multiplies the day's XP — sleeping well is literally worth it
function sleepMult(h) {
  if (h == null || h === '') return 1;
  if (h >= 7) return 1.2;
  if (h >= 6) return 1;
  if (h >= 5) return 0.9;
  return 0.8;
}
const multLabel = m => (m > 1 ? 'Бодрость ×1.2' : m < 1 ? `Разбитость ×${dec(m)}` : 'Норма ×1');

function actMinutes(a, v) { return a.timed ? (v === true ? 60 : +v || 0) : 0; }

function dayXP(date, entry = S.days[date]) {
  const r = { total: 0, by: {}, parts: [], mult: entry ? sleepMult(entry.sleep) : 1 };
  const add = (stat, v, label) => {
    v = Math.round(v);
    if (!v) return;
    r.total += v;
    if (stat) r.by[stat] = (r.by[stat] || 0) + v;
    r.parts.push([label, v]);
  };
  if (entry) {
    add('', 10, 'Запись дня');
    for (const [id, v] of Object.entries(entry.acts || {})) {
      const a = actById(id);
      if (!a || !a.xp) continue;
      add(a.stat, (a.timed ? (a.xp * actMinutes(a, v)) / 60 : a.xp) * r.mult, a.name);
    }
    if (entry.bed) add('', 15, 'Лёг до 00:30');
  }
  for (const t of S.lc) if (t.date === date) add('backend', (LC_XP[t.diff] + (t.morning ? 5 : 0)) * r.mult, 'LeetCode');
  return r;
}

const feynXP = f => ({ backend: 30 + (f.exam?.result?.passed ? f.exam.result.score * 5 : 0), create: 20 });

const levelOf = xp => Math.floor((50 + Math.sqrt(2500 + 200 * xp)) / 100);
const levelStart = L => 50 * L * (L - 1);
const statLevelOf = xp => Math.floor((25 + Math.sqrt(625 + 100 * xp)) / 50);
const statLevelStart = L => 25 * L * (L - 1);

function lcByTopic() {
  const c = {};
  for (const t of S.lc) c[t.topic] = (c[t.topic] || 0) + 1;
  return c;
}

// Stars per node: studied / explained / applied. Algorithm nodes fill from LeetCode counts.
function nodeStars(node, lcCount = lcByTopic()) {
  if (node.auto) {
    const n = lcCount[node.id.slice(3)] || 0;
    return { s: n >= 1, f: n >= 5, a: n >= 15, n, auto: true };
  }
  const t = S.tree[node.id] || {};
  const passed = S.feynman.some(f => f.node === node.id && f.exam?.result?.passed);
  // passing the exam implies the topic was studied
  return { s: !!t.s || passed, f: !!t.f || passed, a: !!t.a, fAuto: passed };
}

function treeProgress() {
  const lcc = lcByTopic();
  let stars = 0, manual = 0;
  const byBranch = {};
  for (const n of TREE_NODES) {
    const st = nodeStars(n, lcc);
    const k = st.s + st.f + st.a;
    stars += k;
    if (!n.auto) manual += k;
    const b = byBranch[n.branch] || (byBranch[n.branch] = { stars: 0, max: 0, studied: 0, nodes: 0 });
    b.stars += k; b.max += 3; b.nodes++; b.studied += st.s ? 1 : 0;
  }
  return { stars, max: TREE_NODES.length * 3, manual, byBranch, pct: stars / (TREE_NODES.length * 3) };
}

/* ---------- streaks with freezes ----------
   Every 7 days in a row earns a ❄️ freeze (max 2). A missed day spends one instead of breaking the streak. */
function streak(has, first) {
  const t = today();
  let cur = 0, best = 0, freezes = 0, frozen = [];
  if (!first) return { cur, best, freezes, frozen };
  for (let d = first; d <= t; d = addDays(d, 1)) {
    if (has(d)) {
      cur++;
      if (cur % 7 === 0) freezes = Math.min(2, freezes + 1);
    } else if (d === t) {
      // today is still open
    } else if (cur > 0 && freezes > 0) {
      freezes--;
      frozen.push(d);
    } else cur = 0;
    best = Math.max(best, cur);
  }
  return { cur, best, freezes, frozen, today: has(t) };
}
const minDate = arr => arr.reduce((a, d) => (!a || d < a ? d : a), null);

function streaks() {
  const dayDates = Object.keys(S.days);
  const lcDates = new Set(S.lc.map(t => t.date));
  const bedDates = dayDates.filter(d => S.days[d].bed);
  return {
    log: streak(d => !!S.days[d], minDate(dayDates)),
    lc: streak(d => lcDates.has(d), minDate([...lcDates])),
    sleep: streak(d => !!S.days[d]?.bed, minDate(bedDates)),
  };
}

function energy() {
  const last = Object.keys(S.days).sort().reverse().map(d => S.days[d].sleep).filter(v => v != null && v !== '').slice(0, 7);
  if (!last.length) return null;
  const avg = last.reduce((a, b) => a + +b, 0) / last.length;
  const pct = Math.min(100, Math.round((avg / 8) * 100));
  return { avg, pct, label: avg >= 7 ? 'бодр' : avg >= 6 ? 'нормально' : avg >= 5 ? 'устал' : 'разбит' };
}

/* ---------- sprints (bosses) ---------- */
const sprintEnd = sp => addDays(sp.start, 6);
const sprintDates = sp => Array.from({ length: 7 }, (_, i) => addDays(sp.start, i));

function goalProgress(sp, g) {
  const e = sprintEnd(sp);
  if (g.type === 'lc') {
    const n = S.lc.filter(t => t.date >= sp.start && t.date <= e).length;
    return { val: Math.min(1, n / (g.target || 1)), label: `${n}/${g.target || 0}`, n };
  }
  if (g.type === 'feynman') {
    const done = g.done || S.feynman.some(f => f.date >= sp.start && f.date <= e);
    return { val: done ? 1 : 0, auto: true };
  }
  return { val: g.done ? 1 : 0 };
}

function bossState(sp) {
  let max = 0, dmg = 0;
  for (const g of sp.goals) {
    const w = GOAL_TYPES[g.type]?.weight || 10;
    max += w;
    dmg += w * goalProgress(sp, g).val;
  }
  const pct = max ? dmg / max : 0;
  return { max, hp: Math.round(max - dmg), pct };
}
const sprintBonus = pct => 30 + Math.round(100 * pct) + (pct >= 0.999 ? 50 : 0);

/* ---------- achievements ---------- */
const ACH = [
  { id: 'first', name: 'Первый шаг', desc: 'Записать первый день', icon: 'flag', ok: c => c.days >= 1 },
  { id: 'week', name: 'Неделя в строю', desc: '7 дней подряд с записью', icon: 'flame', ok: c => c.logBest >= 7 },
  { id: 'month', name: 'Месяц в строю', desc: '30 дней подряд с записью', icon: 'crown', ok: c => c.logBest >= 30 },
  { id: 'early', name: 'Ранняя пташка', desc: '5 задач LeetCode утром', icon: 'sunrise', ok: c => c.lcMorning >= 5 },
  { id: 'owl', name: 'Сова исправилась', desc: '7 ночей подряд до 00:30', icon: 'moon', ok: c => c.sleepBest >= 7 },
  { id: 'energy', name: 'Энерджайзер', desc: 'Неделя со сном 7+ ч в среднем', icon: 'battery-full', ok: c => c.bestWeekSleep >= 7 },
  { id: 'cave', name: 'Вышел из пещеры', desc: '5 дней подряд выходил из дома', icon: 'footprints', ok: c => c.outsideBest >= 5 },
  { id: 'full', name: 'Полный набор', desc: 'День, где есть все 4 сферы', icon: 'sparkles', ok: c => c.fullDay },
  { id: 'lc10', name: 'Разминка', desc: '10 задач LeetCode', icon: 'code', ok: c => c.lc >= 10 },
  { id: 'sw', name: 'Скользящее окно', desc: '12 задач на sliding window', icon: 'layers', ok: c => (c.lcTopic['sliding-window'] || 0) >= 12 },
  { id: 'hard', name: 'Hard mode', desc: 'Решить первую Hard', icon: 'skull', ok: c => c.lcHard >= 1 },
  { id: 'lc100', name: 'Сотня', desc: '100 задач LeetCode', icon: 'trophy', ok: c => c.lc >= 100 },
  { id: 'feyn1', name: 'Объясни просто', desc: 'Первый пост Фейнмана', icon: 'lightbulb', ok: c => c.feyn >= 1 },
  { id: 'feyn5', name: 'Профессор', desc: '5 постов Фейнмана', icon: 'graduation-cap', ok: c => c.feyn >= 5 },
  { id: 'ace', name: 'Отличник', desc: '9+ от ИИ-экзаменатора', icon: 'medal', ok: c => c.bestExam >= 9 },
  { id: 'boss1', name: 'Убийца боссов', desc: 'Победить босса спринта на 100%', icon: 'swords', ok: c => c.bossKills >= 1 },
  { id: 'boss3', name: 'Гроза боссов', desc: 'Три босса подряд на 100%', icon: 'shield-check', ok: c => c.bossRow >= 3 },
  { id: 'branch', name: 'Ветка закрыта', desc: 'Изучить все темы одной ветки дерева', icon: 'git-branch', ok: c => c.branchDone },
];

function achievements(st, tp) {
  const dates = Object.keys(S.days).sort();
  let outsideBest = 0, run = 0, prev = null, fullDay = false;
  for (const d of dates) {
    const e = S.days[d];
    run = e.acts?.outside ? (prev && addDays(prev, 1) === d ? run + 1 : 1) : 0;
    prev = e.acts?.outside ? d : null;
    outsideBest = Math.max(outsideBest, run);
    const sph = new Set(Object.keys(e.acts || {}).map(id => actById(id)?.stat));
    if (SPHERES.every(s => sph.has(s))) fullDay = true;
  }
  let bestWeekSleep = 0;
  const weeks = {};
  for (const d of dates) if (S.days[d].sleep != null && S.days[d].sleep !== '') (weeks[mondayOf(d)] = weeks[mondayOf(d)] || []).push(+S.days[d].sleep);
  for (const v of Object.values(weeks)) if (v.length >= 5) bestWeekSleep = Math.max(bestWeekSleep, v.reduce((a, b) => a + b, 0) / v.length);
  let bossKills = 0, bossRow = 0, r = 0;
  for (const sp of [...S.sprints].sort((a, b) => (a.start < b.start ? -1 : 1))) {
    if (!sp.closed) continue;
    if (sp.result?.pct >= 0.999) { bossKills++; r++; } else r = 0;
    bossRow = Math.max(bossRow, r);
  }
  const c = {
    days: dates.length, logBest: st.log.best, sleepBest: st.sleep.best, outsideBest, fullDay, bestWeekSleep,
    lc: S.lc.length, lcMorning: S.lc.filter(t => t.morning).length, lcHard: S.lc.filter(t => t.diff === 'H').length, lcTopic: lcByTopic(),
    feyn: S.feynman.length, bestExam: Math.max(0, ...S.feynman.map(f => f.exam?.result?.score || 0)),
    bossKills, bossRow, branchDone: Object.values(tp.byBranch).some(b => b.studied === b.nodes),
  };
  return ACH.filter(a => a.ok(c));
}

/* ---------- everything at once ---------- */
function computeAll() {
  const by = {};
  let total = 0;
  const add = (stat, v) => { total += v; if (stat) by[stat] = (by[stat] || 0) + v; };
  const dates = new Set([...Object.keys(S.days), ...S.lc.map(t => t.date)]);
  for (const d of dates) { const x = dayXP(d); total += x.total; for (const k in x.by) by[k] = (by[k] || 0) + x.by[k]; }
  for (const f of S.feynman) { const x = feynXP(f); add('backend', x.backend); add('create', x.create); }
  const tp = treeProgress();
  add('backend', tp.manual * 25);
  for (const sp of S.sprints) if (sp.closed) add('', sprintBonus(sp.result?.pct || 0));
  const st = streaks();
  const ach = achievements(st, tp);
  add('', ach.length * 50);
  const spent = S.purchases.reduce((a, p) => a + p.cost, 0);
  return { total, by, coins: total - spent, level: levelOf(total), tp, st, ach, energy: energy() };
}

/* Apply a change, then report what it earned: XP toast with undo, level-ups, new achievements. */
function commit(mutate, msg) {
  const undo = snapshot();
  const before = computeAll();
  mutate();
  const after = computeAll();
  const newAch = after.ach.filter(a => !S.achSeen[a.id]);
  newAch.forEach(a => (S.achSeen[a.id] = today()));
  save();
  render();
  const diff = after.total - before.total;
  toast(`${msg}${diff > 0 ? ` · +${num(diff)} XP` : diff < 0 ? ` · −${num(-diff)} XP` : ''}`, undo);
  let delay = 400;
  if (after.level > before.level) { setTimeout(() => celebrate(after.level), delay); delay += 2400; }
  newAch.forEach(a => { setTimeout(() => achPop(a), delay); delay += 2600; });
}

/* =========================================================
   Shell
   ========================================================= */
const view = $('#view');
const TITLES = { today: '', tree: 'Дерево навыков', feynman: 'Фейнман', hero: 'Герой' };

function render() {
  const C = computeAll();
  const tb = $('#topbar');
  if (UI.tab === 'today') {
    const t = today();
    tb.innerHTML = `<div class="tb-title"><h1>День ${dayN(t)}</h1><span>${wdDate(t)}</span></div>
      <button class="coin-pill" data-act="tab" data-tab="hero">${icon('coins')}${num(C.coins)}</button>`;
  } else if (UI.tab === 'hero') {
    tb.innerHTML = `<div class="tb-title"><h1>${TITLES.hero}</h1></div><button class="icon-btn" data-act="settings" aria-label="Настройки">${icon('settings')}</button>`;
  } else {
    tb.innerHTML = `<div class="tb-title"><h1>${TITLES[UI.tab]}</h1></div>`;
  }
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === UI.tab));
  const top = view.scrollTop;
  ({ today: renderToday, tree: renderTree, feynman: renderFeynman, hero: renderHero })[UI.tab](C);
  view.scrollTop = top;
}

function setTab(tab) {
  if (tab === UI.tab) { view.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  UI.tab = tab;
  render();
  view.scrollTop = 0;
}

/* =========================================================
   Today
   ========================================================= */
function heroCard(C) {
  const L = C.level, a = levelStart(L), b = levelStart(L + 1);
  const pct = ((C.total - a) / (b - a)) * 100;
  const en = C.energy;
  return `<section class="card hero-card" data-act="tab" data-tab="hero">
    <div class="hero-row">
      <div class="lvl-badge"><small>ур.</small>${L}</div>
      <div class="hero-main">
        <div class="hero-name">${esc(S.profile.name || 'Герой')}</div>
        <div class="xpbar"><i style="width:${pct}%"></i></div>
        <div class="hero-sub">${num(C.total - a)} / ${num(b - a)} XP до ${L + 1} уровня</div>
      </div>
    </div>
    <div class="energy-row ${en ? (en.avg >= 7 ? 'good' : en.avg < 6 ? 'low' : '') : ''}">
      ${icon(en && en.avg < 6 ? 'battery-low' : 'battery')}
      <span>Энергия</span>
      <div class="ebar"><i style="width:${en ? en.pct : 0}%"></i></div>
      <b>${en ? `${en.pct}% · ${en.label}` : 'нет данных'}</b>
    </div>
  </section>`;
}

function questCard(C) {
  const left = dayDiff(today(), S.profile.deadline);
  const pct = Math.round(C.tp.pct * 100);
  return `<section class="card quest-card" data-act="tab" data-tab="tree">
    <div class="quest-ic">${icon('target')}</div>
    <div class="quest-main">
      <div class="quest-label">Главный квест · осталось ${num(Math.max(0, left))} ${plural(left, DAYS)}</div>
      <div class="quest-goal">${esc(S.profile.goal)}</div>
      <div class="qbar"><i style="width:${pct}%"></i></div>
    </div>
    <div class="quest-pct">${pct}<small>%</small></div>
  </section>`;
}

function streakChips(C) {
  const chip = (label, s, ic) => `<div class="streak ${s.cur ? 'on' : ''} ${s.today ? 'done' : ''}">
    <div class="st-top">${icon('flame')}<b>${s.cur}</b>${s.freezes ? `<span class="frz">${icon('snowflake')}${s.freezes}</span>` : ''}</div>
    <span>${icon(ic)}${label}</span>
  </div>`;
  return `<div class="streaks">${chip('Дневник', C.st.log, 'scroll-text')}${chip('LeetCode', C.st.lc, 'code')}${chip('До 00:30', C.st.sleep, 'moon')}</div>`;
}

function todayCard() {
  const t = today(), y = addDays(t, -1);
  const e = S.days[t];
  const missedY = !S.days[y] && y >= S.profile.day1;
  if (!e) {
    return `<section class="card today-card">
      <div class="today-cta">
        <div><h3>Как прошёл день?</h3><p>Запись — +10 XP, занятия умножаются на бодрость от сна</p></div>
        <button class="btn primary" data-act="day" data-date="${t}">${icon('pencil')} Записать</button>
      </div>
      ${missedY ? `<button class="linkish" data-act="day" data-date="${y}">Вчера (день ${dayN(y)}) не записан — записать</button>` : ''}
    </section>`;
  }
  const x = dayXP(t);
  const acts = Object.keys(e.acts || {}).map(actById).filter(Boolean);
  return `<section class="card today-card" data-act="day" data-date="${t}">
    <div class="today-top">
      <div class="big-rate">${e.rating ?? '—'}<small>/10</small></div>
      <div class="today-meta">
        <span>${icon('bed')} сон ${e.sleep != null && e.sleep !== '' ? dec(e.sleep) + ' ч' : '—'}</span>
        <span class="mult ${x.mult > 1 ? 'up' : x.mult < 1 ? 'down' : ''}">${multLabel(x.mult)}</span>
      </div>
      <div class="today-xp">+${num(x.total)}<small>XP</small></div>
    </div>
    ${acts.length ? `<div class="act-icons">${acts.map(a => `<span title="${esc(a.name)}" style="--c:${STATS[a.stat]?.color || 'var(--text-3)'}">${icon(a.icon)}</span>`).join('')}</div>` : ''}
    <div class="row-actions">
      <button class="btn small" data-act="day" data-date="${t}">${icon('pencil')} Изменить</button>
      <button class="btn small" data-act="copy-day" data-date="${t}">${icon('copy')} Пост</button>
    </div>
    ${missedY ? `<button class="linkish" data-act="day" data-date="${y}">Вчера (день ${dayN(y)}) не записан — записать</button>` : ''}
  </section>`;
}

function activeSprints() {
  const t = today();
  const open = S.sprints.filter(s => !s.closed).sort((a, b) => (a.start < b.start ? -1 : 1));
  const pending = open.find(s => sprintEnd(s) < t);
  const current = open.find(s => s.start <= t && sprintEnd(s) >= t);
  const upcoming = open.find(s => s.start > t);
  return { pending, current, upcoming };
}
const lastSprint = () => [...S.sprints].sort((a, b) => b.n - a.n)[0];

function bossCard() {
  const { pending, current, upcoming } = activeSprints();
  const sp = pending || current || upcoming;
  const t = today();
  if (!sp) {
    return `<section class="card boss-card none">
      <div class="boss-head">${icon('swords')}<div><h3>Нет активного спринта</h3><p>Спланируй неделю — и босс появится</p></div></div>
      <button class="btn primary wide" data-act="plan">${icon('flag')} Спланировать спринт ${S.profile.nextSprint}</button>
    </section>`;
  }
  const b = bossState(sp);
  const ended = sprintEnd(sp) < t;
  const notStarted = sp.start > t;
  const daysLeft = dayDiff(t, sprintEnd(sp)) + 1;
  const canRetro = ended || dateOf(t).getDay() === 0 || dateOf(t).getDay() === 6;
  const status = notStarted ? `начнётся ${wdDate(sp.start)}` : ended ? 'неделя закончилась' : daysLeft === 1 ? 'последний день' : `${daysLeft} ${plural(daysLeft, DAYS)} до конца`;
  return `<section class="card boss-card ${b.hp <= 0 ? 'dead' : ''}">
    <div class="boss-head">
      <div class="boss-ic">${icon(b.hp <= 0 ? 'trophy' : 'skull')}</div>
      <div><h3>Босс спринта ${sp.n}</h3><p>${status}</p></div>
      <button class="icon-btn" data-act="plan" data-id="${sp.id}" aria-label="Изменить план">${icon('pencil')}</button>
    </div>
    <div class="hp"><div class="hpbar"><i style="width:${(b.hp / (b.max || 1)) * 100}%"></i></div><span>${b.hp <= 0 ? 'Повержен!' : `HP ${b.hp}/${b.max}`}</span></div>
    <div class="goals">${sp.goals.map(g => {
      const p = goalProgress(sp, g), gt = GOAL_TYPES[g.type];
      const manual = (g.type === 'topic' || g.type === 'life' || (g.type === 'feynman' && !p.auto));
      return `<div class="goal ${p.val >= 1 ? 'done' : ''}" ${manual || g.type === 'feynman' ? `data-act="goal" data-sp="${sp.id}" data-g="${g.id}"` : ''}>
        <span class="g-ic">${icon(p.val >= 1 ? 'circle-check' : gt.icon)}</span>
        <span class="g-text">${esc(g.text || gt.name)}</span>
        ${g.type === 'lc' ? `<span class="g-prog"><span class="mini"><i style="width:${p.val * 100}%"></i></span>${p.label}</span>` : ''}
        <span class="g-w">−${gt.weight}</span>
      </div>`;
    }).join('')}</div>
    ${canRetro && !notStarted ? `<button class="btn ${ended ? 'primary' : ''} wide" data-act="retro" data-id="${sp.id}">${icon('scroll-text')} Ретро и закрыть спринт</button>` : ''}
    ${notStarted && S.sprints.some(s => s.n === sp.n - 1) ? `<button class="btn wide" data-act="copy-week" data-id="${sp.id}">${icon('copy')} Пост недели (ретро + план)</button>` : ''}
  </section>`;
}

function lcCard(C) {
  const t = today();
  const todayN = S.lc.filter(x => x.date === t).length;
  const { current } = activeSprints();
  const g = current?.goals.find(x => x.type === 'lc');
  const spN = current ? S.lc.filter(x => x.date >= current.start && x.date <= sprintEnd(current)).length : null;
  let pace = '';
  if (g && current) {
    const daysLeft = dayDiff(t, sprintEnd(current)) + 1;
    const need = Math.max(0, (g.target || 0) - spN);
    pace = need ? `нужно ${need} за ${daysLeft} ${plural(daysLeft, DAYS)} · ≈${dec(need / Math.max(1, daysLeft))}/день` : 'цель спринта выполнена 🎉';
  }
  const morning = new Date().getHours() < 12;
  return `<section class="card lc-card">
    <div class="lc-head">
      <div><h3>LeetCode</h3><p>${todayN ? `сегодня ${todayN} ${plural(todayN, ['задача', 'задачи', 'задач'])}` : C.st.lc.cur ? 'реши задачу, чтобы сохранить стрик' : 'сегодня ещё ни одной'}${g ? ` · спринт ${spN}/${g.target}` : ''}</p>${pace ? `<p class="pace">${pace}</p>` : ''}</div>
      ${morning ? `<span class="badge-morning">${icon('sunrise')} утро +5</span>` : ''}
    </div>
    <div class="lc-btns">
      <button class="lcb e" data-act="lc" data-diff="E">+ Easy<small>${LC_XP.E} XP</small></button>
      <button class="lcb m" data-act="lc" data-diff="M">+ Medium<small>${LC_XP.M} XP</small></button>
      <button class="lcb h" data-act="lc" data-diff="H">+ Hard<small>${LC_XP.H} XP</small></button>
    </div>
  </section>`;
}

function feynPrompt() {
  const t = today(), wd = dateOf(t).getDay();
  const wk = mondayOf(t);
  if (wd !== 6 || S.feynman.some(f => f.date >= wk)) return '';
  return `<section class="card prompt-card" data-act="feyn-new">${icon('lightbulb')}<div><h3>Суббота — время Фейнмана</h3><p>Объясни тему недели своими словами · +50 XP</p></div>${icon('chevron-right')}</section>`;
}

function renderToday(C) {
  view.innerHTML = heroCard(C) + questCard(C) + streakChips(C) + todayCard() + feynPrompt() + bossCard() + lcCard(C);
}

/* =========================================================
   Day entry
   ========================================================= */
function defaultTags(e, date) {
  const tags = new Set();
  for (const id of Object.keys(e.acts || {})) { const tg = actById(id)?.tag; if (tg) tags.add(tg); }
  if (S.lc.some(t => t.date === date)) tags.add('leetcode');
  return [...tags].join(' ');
}

function openDay(date) {
  const ex = S.days[date];
  const e = ex ? clone(ex) : { rating: 7, sleep: 7, bed: false, acts: {}, studied: '', pleasant: '', annoying: '', tags: '' };
  const n = dayN(date);
  const sh = openSheet(`
    ${sheetHead(`День ${n}`, wdDate(date))}
    ${AI.ready ? `<div class="ai-box">
      <textarea id="d-story" rows="2" placeholder="Расскажи о дне — можно голосом через 🎤 на клавиатуре"></textarea>
      <button class="btn ai" id="d-ai">${icon('wand-sparkles')} Разобрать</button>
    </div>` : ''}
    <div class="slider-field">
      <div class="sf-top"><span>Оценка дня</span><b id="d-rate-v"></b></div>
      <input type="range" id="d-rate" min="1" max="10" step="1" value="${e.rating ?? 7}">
    </div>
    <div class="slider-field">
      <div class="sf-top"><span>Сон</span><b id="d-sleep-v"></b></div>
      <input type="range" id="d-sleep" min="0" max="12" step="0.5" value="${e.sleep ?? 7}">
    </div>
    <div class="field"><span>Лёг до 00:30 прошлой ночью <small>+15 XP</small></span><input type="checkbox" class="switch" id="d-bed" ${e.bed ? 'checked' : ''}></div>
    <div class="label">Что делал</div>
    <div class="acts" id="d-acts"></div>
    <div class="field col"><span>Изучал</span><input id="d-studied" placeholder="Redis sorted sets, outbox…" value="${esc(e.studied)}" autocomplete="off" enterkeyhint="done"></div>
    <div class="field col"><span>Приятно</span><textarea id="d-pleasant" rows="2" placeholder="Что порадовало">${esc(e.pleasant)}</textarea></div>
    <div class="field col"><span>Раздражало</span><textarea id="d-annoying" rows="2" placeholder="Что мешало или бесило">${esc(e.annoying)}</textarea></div>
    <div class="field col"><span>Теги</span><input id="d-tags" placeholder="" value="${esc(e.tags)}" autocomplete="off" enterkeyhint="done"></div>
    <div class="xp-preview" id="d-xp"></div>
    <div class="actions">
      ${ex ? `<button class="btn danger" id="d-del" aria-label="Удалить">${icon('trash-2')}</button>` : ''}
      <button class="btn primary" id="d-save">Сохранить</button>
    </div>`);

  const rate = $('#d-rate', sh), slp = $('#d-sleep', sh), bed = $('#d-bed', sh);
  const read = () => {
    e.rating = +rate.value;
    e.sleep = +slp.value;
    e.bed = bed.checked;
    e.studied = $('#d-studied', sh).value.trim();
    e.pleasant = $('#d-pleasant', sh).value.trim();
    e.annoying = $('#d-annoying', sh).value.trim();
    e.tags = $('#d-tags', sh).value.trim();
  };
  const paintActs = () => {
    $('#d-acts', sh).innerHTML = S.activities.map(a => {
      const on = e.acts[a.id] !== undefined;
      const st = STATS[a.stat];
      const mins = actMinutes(a, e.acts[a.id]);
      return `<div class="act ${on ? 'on' : ''}" style="--c:${st?.color || 'var(--text-3)'}">
        <button type="button" class="act-btn" data-a="${a.id}">${icon(a.icon)}<span>${esc(a.name)}</span>${a.xp ? `<small>${a.timed ? `${a.xp}/ч` : `+${a.xp}`}</small>` : ''}</button>
        ${on && a.timed ? `<div class="stepper"><button type="button" data-step="-30" data-a="${a.id}">−</button><b>${mins >= 60 ? dec(mins / 60) + ' ч' : mins + ' мин'}</b><button type="button" data-step="30" data-a="${a.id}">+</button></div>` : ''}
      </div>`;
    }).join('');
  };
  const paint = () => {
    read();
    $('#d-rate-v', sh).textContent = `${e.rating}/10`;
    const m = sleepMult(e.sleep);
    $('#d-sleep-v', sh).innerHTML = `${dec(e.sleep)} ч <span class="mult ${m > 1 ? 'up' : m < 1 ? 'down' : ''}">${multLabel(m)}</span>`;
    $('#d-tags', sh).placeholder = defaultTags(e, date) || 'gym dota redis';
    const x = dayXP(date, e);
    $('#d-xp', sh).innerHTML = `${icon('sparkles')} <b>+${num(x.total)} XP</b> за день${x.parts.length ? ` <small>(${x.parts.map(([l, v]) => `${esc(l)} ${v}`).join(', ')})</small>` : ''}`;
  };
  paintActs();
  paint();
  sh.addEventListener('input', paint);
  sh.addEventListener('change', paint);
  $('#d-acts', sh).addEventListener('click', ev => {
    const step = ev.target.closest('[data-step]');
    if (step) {
      const a = actById(step.dataset.a);
      e.acts[a.id] = Math.max(30, actMinutes(a, e.acts[a.id]) + +step.dataset.step);
    } else {
      const b = ev.target.closest('[data-a]');
      if (!b) return;
      const a = actById(b.dataset.a);
      if (e.acts[a.id] !== undefined) delete e.acts[a.id];
      else e.acts[a.id] = a.timed ? 60 : true;
    }
    paintActs();
    paint();
  });

  $('#d-ai', sh)?.addEventListener('click', async ev => {
    const story = $('#d-story', sh).value.trim();
    if (!story) return $('#d-story', sh).focus();
    const btn = ev.currentTarget;
    busy(btn, true);
    try {
      const r = await AI.parseDay(story, S.activities);
      if (r.rating) rate.value = Math.max(1, Math.min(10, Math.round(r.rating)));
      if (r.sleep != null) slp.value = Math.max(0, Math.min(12, Math.round(r.sleep * 2) / 2));
      if (r.bedBefore != null) bed.checked = !!r.bedBefore;
      for (const id of r.activities || []) {
        const a = actById(id);
        if (a) e.acts[id] = a.timed ? (r.minutes?.[id] || 60) : true;
      }
      const fill = (sel, v) => { if (v) $(sel, sh).value = v; };
      fill('#d-studied', r.studied); fill('#d-pleasant', r.pleasant); fill('#d-annoying', r.annoying);
      paintActs();
      paint();
      toast('Готово — проверь и сохрани');
    } catch (err) { toast(err.message); }
    busy(btn, false);
  });

  $('#d-save', sh).onclick = () => {
    read();
    closeSheet();
    commit(() => { S.days[date] = { ...e, ts: Date.now() }; }, ex ? `День ${n} обновлён` : `День ${n} записан`);
  };
  if (ex) $('#d-del', sh).onclick = () => {
    closeSheet();
    commit(() => { delete S.days[date]; }, `День ${n} удалён`);
  };
}

/* =========================================================
   LeetCode
   ========================================================= */
function openLC(diff, id) {
  const ex = id ? S.lc.find(t => t.id === id) : null;
  const last = [...S.lc].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  const t = ex ? clone(ex) : { diff, topic: last?.topic || 'sliding-window', title: '', morning: new Date().getHours() < 12, date: today() };
  const sh = openSheet(`
    ${sheetHead(ex ? 'Задача LeetCode' : 'Решил задачу')}
    <div class="seg wide" id="l-diff">${['E', 'M', 'H'].map(d => `<button type="button" data-d="${d}" class="${t.diff === d ? 'on' : ''}">${{ E: 'Easy', M: 'Medium', H: 'Hard' }[d]}</button>`).join('')}</div>
    <div class="label">Тема</div>
    <div class="chips" id="l-topic">${LC_TOPICS.map(([k, n]) => `<button type="button" class="chip ${t.topic === k ? 'on' : ''}" data-t="${k}">${n}</button>`).join('')}</div>
    <div class="field"><span>Название</span><input id="l-title" placeholder="необязательно" value="${esc(t.title)}" autocomplete="off" enterkeyhint="done"></div>
    <div class="field"><span>До работы / утром <small>+5 XP</small></span><input type="checkbox" class="switch" id="l-morning" ${t.morning ? 'checked' : ''}></div>
    <div class="field"><span>Дата</span><input type="date" id="l-date" value="${t.date}"></div>
    <div class="actions">
      ${ex ? `<button class="btn danger" id="l-del" aria-label="Удалить">${icon('trash-2')}</button>` : ''}
      <button class="btn primary" id="l-save">Сохранить</button>
    </div>`);
  $('#l-diff', sh).onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; t.diff = b.dataset.d; $$('#l-diff button', sh).forEach(x => x.classList.toggle('on', x === b)); };
  $('#l-topic', sh).onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; t.topic = b.dataset.t; $$('#l-topic .chip', sh).forEach(x => x.classList.toggle('on', x === b)); };
  $('#l-save', sh).onclick = () => {
    const rec = { id: ex?.id || uid(), diff: t.diff, topic: t.topic, title: $('#l-title', sh).value.trim(), morning: $('#l-morning', sh).checked, date: $('#l-date', sh).value || today(), ts: ex?.ts || Date.now() };
    closeSheet();
    commit(() => { if (ex) S.lc[S.lc.findIndex(x => x.id === ex.id)] = rec; else S.lc.push(rec); }, ex ? 'Задача обновлена' : 'Задача решена');
  };
  if (ex) $('#l-del', sh).onclick = () => { closeSheet(); commit(() => { S.lc = S.lc.filter(x => x.id !== ex.id); }, 'Задача удалена'); };
}

/* =========================================================
   Sprint planning & retro
   ========================================================= */
function defaultSprintStart() {
  const t = today();
  if (dateOf(t).getDay() === 0) return addDays(t, 1); // Sunday evening → plan the coming week
  const mon = mondayOf(t);
  return S.sprints.some(s => s.start === mon) ? addDays(mon, 7) : mon;
}

const nodeLabel = id => {
  const n = TREE_NODES.find(x => x.id === id);
  return n ? `${TREE.find(b => b.id === n.branch).name}: ${n.name}` : '';
};

// The next unstudied topic of every branch, in roadmap order — variety without decision fatigue
function nextTopics(exclude = new Set()) {
  const lcc = lcByTopic();
  const out = [];
  for (const b of TREE) {
    if (b.auto) continue;
    const n = TREE_NODES.find(x => x.branch === b.id && !exclude.has(x.id) && !nodeStars(x, lcc).s);
    if (n) out.push(n.id);
  }
  return out;
}

const cleanGoal = g => {
  const type = GOAL_TYPES[g.type] ? g.type : 'topic';
  const node = type === 'topic' && TREE_NODES.some(n => n.id === g.node && !n.auto) ? g.node : undefined;
  return { id: uid(), type, text: (g.text || '').trim() || (node ? nodeLabel(node) : ''), target: +g.target || 12, done: false, node };
};

function planContext() {
  const tp = treeProgress();
  const lcc = lcByTopic();
  const recent = Object.keys(S.days).sort().slice(-14).map(d => S.days[d]);
  const avg = k => { const v = recent.map(e => e[k]).filter(x => x != null && x !== ''); return v.length ? +(v.reduce((a, b) => a + +b, 0) / v.length).toFixed(1) : null; };
  const candidates = [];
  for (const b of TREE) {
    if (b.auto) continue;
    TREE_NODES.filter(x => x.branch === b.id && !nodeStars(x, lcc).s).slice(0, 3).forEach(x => candidates.push({ id: x.id, topic: nodeLabel(x.id) }));
  }
  return {
    goal: S.profile.goal,
    deadline: S.profile.deadline,
    days_left: dayDiff(today(), S.profile.deadline),
    readiness_pct: Math.round(tp.pct * 100),
    branches: TREE.map(b => `${b.name}: ${tp.byBranch[b.id].stars}/${tp.byBranch[b.id].max} звёзд`),
    candidate_topics: candidates,
    leetcode_solved_by_pattern: Object.fromEntries(LC_TOPICS.map(([k, n]) => [`${k} (${n})`, lcc[k] || 0])),
    previous_sprints: S.sprints.filter(s => s.closed).sort((a, b) => b.n - a.n).slice(0, 3)
      .map(s => ({ n: s.n, plan_vs_fact: s.goals.map(g => `${g.text}: ${goalMark(s, g)}`), conclusion: s.retro?.conclusion || '' })),
    diary_last_14_days: recent.length ? {
      entries: recent.length, avg_rating: avg('rating'), avg_sleep: avg('sleep'),
      days_went_outside: recent.filter(e => e.acts?.outside).length,
      days_gym: recent.filter(e => e.acts?.gym).length,
    } : 'дневник пока пуст',
  };
}

function openPlanner(id, pre) {
  const ex = id ? S.sprints.find(s => s.id === id) : null;
  const last = lastSprint();
  const sp = ex ? clone(ex) : {
    n: last ? last.n + 1 : S.profile.nextSprint,
    start: pre?.start || (last && !last.closed ? addDays(last.start, 7) : defaultSprintStart()),
    goals: pre?.goals?.length ? pre.goals.map(cleanGoal)
      : [{ id: uid(), type: 'topic', text: '' }, { id: uid(), type: 'lc', text: 'LeetCode', target: 12 }, { id: uid(), type: 'feynman', text: '' }, { id: uid(), type: 'life', text: '' }],
  };
  const sh = openSheet(`
    ${sheetHead(ex ? `Спринт ${sp.n}` : 'Планирование спринта')}
    ${pre?.goals?.length ? `<p class="note ai-note">${icon('wand-sparkles')} План предложил ИИ-коуч — поправь под себя</p>` : ''}
    <div class="field"><span>Номер спринта</span><input id="p-n" inputmode="numeric" value="${sp.n}"></div>
    <div class="field"><span>Начало (понедельник)</span><input type="date" id="p-start" value="${sp.start}"></div>
    ${AI.ready ? `<button type="button" class="btn ai wide plan-ai" id="p-ai">${icon('wand-sparkles')} Предложить план с ИИ</button>
      <p class="note ai-note" id="p-why" hidden></p>` : '<p class="note">Добавь ключ OpenAI в настройках — ИИ сможет предлагать план спринта.</p>'}
    <div class="label">Цели = урон по боссу</div>
    <div id="p-goals"></div>
    <div class="add-goals">${Object.entries(GOAL_TYPES).map(([k, g]) => `<button type="button" class="chip" data-add="${k}">${icon(g.icon)} ${g.name}</button>`).join('')}</div>
    <div class="label">Следующие темы из дерева</div>
    <div class="chips tree-chips" id="p-tree"></div>
    <p class="note">Тема — 30 HP, LeetCode — 40, Фейнман — 20, Жизнь — 10. Фейнман засчитается сам, как только появится пост на этой неделе; LeetCode считается по решённым задачам.</p>
    <div class="actions">
      ${ex ? `<button class="btn danger" id="p-del" aria-label="Удалить">${icon('trash-2')}</button>` : ''}
      <button class="btn primary" id="p-save">${ex ? 'Сохранить' : 'Вызвать босса'}</button>
    </div>`);
  const ph = { topic: 'Redis — распределённые локи', lc: 'LeetCode (sliding window)', feynman: 'Cache-aside и инвалидация', life: 'Сходить в коворкинг' };
  const readGoals = () => $$('.pg', sh).forEach(row => {
    const g = sp.goals.find(x => x.id === row.dataset.g);
    g.text = $('.pg-text', row).value.trim();
    if (g.type === 'lc') g.target = Math.max(1, +$('.pg-target', row).value || 1);
  });
  const paint = () => {
    $('#p-goals', sh).innerHTML = sp.goals.map(g => `<div class="pg" data-g="${g.id}">
      <span class="pg-ic" ${g.node ? 'title="Тема из дерева"' : ''}>${icon(g.node ? 'network' : GOAL_TYPES[g.type].icon)}</span>
      <input class="pg-text" placeholder="${ph[g.type]}" value="${esc(g.text)}" autocomplete="off" enterkeyhint="done">
      ${g.type === 'lc' ? `<input class="pg-target" inputmode="numeric" value="${g.target || 12}" aria-label="Сколько задач">` : ''}
      <button type="button" class="icon-btn" data-rm="${g.id}" aria-label="Убрать">${icon('x')}</button>
    </div>`).join('');
    const picked = new Set(sp.goals.map(g => g.node).filter(Boolean));
    const next = nextTopics(picked);
    $('#p-tree', sh).innerHTML = next.length
      ? next.map(nid => `<button type="button" class="chip" data-node="${nid}">${icon('plus')} ${esc(nodeLabel(nid))}</button>`).join('')
      : '<span class="note">Все темы дерева изучены 🎉</span>';
  };
  paint();
  sh.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    const rm = e.target.closest('[data-rm]');
    const nd = e.target.closest('[data-node]');
    if (!add && !rm && !nd) return;
    readGoals();
    if (add) sp.goals.push({ id: uid(), type: add.dataset.add, text: '', target: 12 });
    if (rm) sp.goals = sp.goals.filter(g => g.id !== rm.dataset.rm);
    if (nd) {
      // fill an empty topic slot first, otherwise add a new goal
      const empty = sp.goals.find(g => g.type === 'topic' && !g.text && !g.node);
      if (empty) Object.assign(empty, { text: nodeLabel(nd.dataset.node), node: nd.dataset.node });
      else sp.goals.splice(sp.goals.filter(g => g.type === 'topic').length, 0, { id: uid(), type: 'topic', text: nodeLabel(nd.dataset.node), node: nd.dataset.node });
    }
    paint();
  });
  $('#p-ai', sh)?.addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    busy(btn, true);
    try {
      const r = await AI.plan(planContext());
      const goals = (r.plan || []).map(cleanGoal).filter(g => g.text || g.type === 'lc');
      if (!goals.length) throw new Error('ИИ не предложил целей, попробуй ещё раз');
      sp.goals = goals;
      paint();
      const why = $('#p-why', sh);
      why.innerHTML = `${icon('wand-sparkles')} ${esc(r.why || 'План предложил ИИ — поправь под себя')}`;
      why.hidden = false;
    } catch (err) { toast(err.message); }
    busy(btn, false);
  });
  $('#p-save', sh).onclick = () => {
    readGoals();
    sp.goals = sp.goals.filter(g => g.text || g.type === 'lc');
    sp.goals.forEach(g => { if (!g.text) g.text = GOAL_TYPES[g.type].name; });
    if (!sp.goals.length) return toast('Добавь хотя бы одну цель');
    const n = Math.max(1, +$('#p-n', sh).value || sp.n);
    const start = mondayOf($('#p-start', sh).value || sp.start);
    closeSheet();
    commit(() => {
      if (ex) Object.assign(S.sprints.find(s => s.id === ex.id), { n, start, goals: sp.goals });
      else S.sprints.push({ id: uid(), n, start, goals: sp.goals, retro: null, closed: false });
      S.profile.nextSprint = Math.max(S.profile.nextSprint, n + 1);
    }, ex ? 'План обновлён' : `Босс спринта ${n} вызван`);
  };
  if (ex) $('#p-del', sh).onclick = () => { closeSheet(); commit(() => { S.sprints = S.sprints.filter(s => s.id !== ex.id); }, `Спринт ${sp.n} удалён`); };
}

function toggleGoal(spId, gId) {
  const sp = S.sprints.find(s => s.id === spId);
  const g = sp?.goals.find(x => x.id === gId);
  if (!g || sp.closed) return;
  if (g.type === 'feynman' && goalProgress(sp, { ...g, done: false }).val) return toast('Засчитано автоматически — есть пост Фейнмана');
  const star = !g.done && g.node && !(S.tree[g.node] || {}).s;
  commit(() => {
    g.done = !g.done;
    if (star) S.tree[g.node] = { ...(S.tree[g.node] || {}), s: true };
  }, g.done ? 'Цель снова открыта' : `Удар по боссу: −${GOAL_TYPES[g.type].weight} HP${star ? ' · ⭐ тема изучена' : ''}`);
}

function weekStats(sp) {
  const ds = sprintDates(sp).filter(d => S.days[d]);
  const rated = ds.filter(d => S.days[d].rating != null);
  const avg = rated.length ? rated.reduce((a, d) => a + S.days[d].rating, 0) / rated.length : null;
  const sorted = [...rated].sort((a, b) => S.days[b].rating - S.days[a].rating);
  const best = sorted.slice(0, 2), worst = sorted.length > 2 ? sorted.slice(-2).reverse() : [];
  const sleeps = ds.map(d => S.days[d].sleep).filter(v => v != null && v !== '');
  const avgSleep = sleeps.length ? sleeps.reduce((a, b) => a + +b, 0) / sleeps.length : null;
  const spheres = SPHERES.map(s => {
    const names = new Set(), days = new Set();
    for (const d of ds) for (const id of Object.keys(S.days[d].acts || {})) {
      const a = actById(id);
      if (a?.stat === s) { names.add(a.name.toLowerCase()); days.add(d); }
    }
    return { s, mark: days.size >= 2 ? '✅' : days.size === 1 ? '⚠️' : '❌', names: [...names] };
  });
  return { ds, avg, best, worst, avgSleep, spheres };
}

function goalMark(sp, g) {
  const p = goalProgress(sp, g);
  if (g.type === 'lc') return `${p.n}/${g.target} ${p.val >= 1 ? '✅' : p.val > 0 ? '⚠️' : '❌'}`;
  return p.val >= 1 ? '✅' : '❌';
}

function openRetro(id) {
  const sp = S.sprints.find(s => s.id === id);
  const b = bossState(sp);
  const w = weekStats(sp);
  const r = sp.retro || { hindered: '', worked: '', conclusion: '', aiPlan: null };
  const sphereLine = w.spheres.map(x => `${STATS[x.s].name.toLowerCase()} ${x.mark}${x.names.length ? ` (${x.names.join(', ')})` : ''}`).join(', ');
  const sh = openSheet(`
    ${sheetHead(`Ретро спринта ${sp.n}`, `${shortDate(sp.start)} – ${shortDate(sprintEnd(sp))}`)}
    <div class="boss-result ${b.pct >= 0.999 ? 'win' : ''}">
      ${icon(b.pct >= 0.999 ? 'trophy' : 'skull')}
      <div><b>${b.pct >= 0.999 ? 'Босс повержен!' : `Босс ранен на ${Math.round(b.pct * 100)}%`}</b><span>Награда за спринт: +${sprintBonus(b.pct)} XP</span></div>
    </div>
    <div class="label">План → факт</div>
    <div class="facts">${sp.goals.map(g => `<div><span>${esc(g.text)}</span><b>${goalMark(sp, g)}</b></div>`).join('')}</div>
    <div class="label">Неделя по дневнику</div>
    <div class="facts">
      <div><span>Средняя оценка</span><b>${w.avg != null ? dec(w.avg) + '/10' : '—'}</b></div>
      <div><span>Средний сон</span><b>${w.avgSleep != null ? dec(w.avgSleep) + ' ч' : '—'}</b></div>
      <div><span>Лучшие дни</span><b>${w.best.map(d => WD[dateOf(d).getDay()]).join(', ') || '—'}</b></div>
      <div><span>Худшие</span><b>${w.worst.map(d => WD[dateOf(d).getDay()]).join(', ') || '—'}</b></div>
      <div><span>Записано дней</span><b>${w.ds.length}/7</b></div>
    </div>
    <p class="note">Сферы: ${esc(sphereLine)}</p>
    ${AI.ready ? `<button class="btn ai wide" id="r-ai">${icon('wand-sparkles')} Черновик от ИИ-коуча</button>` : `<p class="note">Добавь ключ OpenAI в настройках — коуч напишет черновик ретро и предложит план.</p>`}
    <div class="field col"><span>Что мешало</span><textarea id="r-h" rows="2">${esc(r.hindered)}</textarea></div>
    <div class="field col"><span>Что сработало</span><textarea id="r-w" rows="2">${esc(r.worked)}</textarea></div>
    <div class="field col"><span>Вывод</span><textarea id="r-c" rows="2">${esc(r.conclusion)}</textarea></div>
    <div class="actions">
      <button class="btn" id="r-copy">${icon('copy')} Пост</button>
      <button class="btn primary" id="r-close">Закрыть спринт</button>
    </div>`);
  const read = () => ({ hindered: $('#r-h', sh).value.trim(), worked: $('#r-w', sh).value.trim(), conclusion: $('#r-c', sh).value.trim(), aiPlan: r.aiPlan });

  $('#r-ai', sh)?.addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    busy(btn, true);
    try {
      const prevSprints = S.sprints.filter(s => s.closed && s.id !== sp.id).sort((a, b) => b.n - a.n).slice(0, 3)
        .map(s => ({ n: s.n, goals: s.goals.map(g => `${g.text}: ${goalMark(s, g)}`), retro: s.retro?.conclusion }));
      const ctx = {
        deadline: S.profile.deadline,
        sprint: sp.n,
        plan_vs_fact: sp.goals.map(g => `${g.text}: ${goalMark(sp, g)}`),
        days: w.ds.map(d => {
          const e = S.days[d];
          return { day: WD[dateOf(d).getDay()], rating: e.rating, sleep: e.sleep, bed_before_0030: e.bed,
            did: Object.entries(e.acts || {}).map(([id, v]) => { const a = actById(id); return a ? a.name + (a.timed ? ` ${actMinutes(a, v)} мин` : '') : ''; }).filter(Boolean),
            leetcode: S.lc.filter(t => t.date === d).map(t => `${t.diff}${t.morning ? ' утром' : ''}`),
            studied: e.studied, pleasant: e.pleasant, annoying: e.annoying };
        }),
        spheres: sphereLine,
        previous_sprints: prevSprints,
        candidate_topics: planContext().candidate_topics,
      };
      const res = await AI.retro(ctx);
      if (res.hindered) $('#r-h', sh).value = res.hindered;
      if (res.worked) $('#r-w', sh).value = res.worked;
      if (res.conclusion) $('#r-c', sh).value = res.conclusion;
      if (Array.isArray(res.plan)) r.aiPlan = res.plan;
      toast('Черновик готов — поправь своими словами');
    } catch (err) { toast(err.message); }
    busy(btn, false);
  });

  $('#r-copy', sh).onclick = () => copyText(weekPost(sp, read()));
  $('#r-close', sh).onclick = () => {
    const retro = read();
    const pct = bossState(sp).pct;
    closeSheet();
    commit(() => {
      const s = S.sprints.find(x => x.id === sp.id);
      s.retro = retro;
      s.closed = true;
      s.result = { pct };
    }, `Спринт ${sp.n} закрыт`);
    if (!S.sprints.some(s => s.n === sp.n + 1)) setTimeout(() => openPlanner(null, { start: addDays(sp.start, 7), goals: retro.aiPlan }), 450);
  };
}

/* =========================================================
   Feynman
   ========================================================= */
function renderFeynman() {
  const list = [...S.feynman].sort((a, b) => b.n - a.n);
  const nextN = (S.feynman.reduce((m, f) => Math.max(m, f.n), 0)) + 1;
  view.innerHTML = `
    <button class="btn primary wide big" data-act="feyn-new">${icon('plus')} Фейнман #${nextN}</button>
    <p class="note center">Объясни тему своими словами · +50 XP. ИИ-экзаменатор проверит, и зачёт даст ⭐⭐ теме в дереве.</p>
    ${list.length ? list.map(f => {
      const node = TREE_NODES.find(n => n.id === f.node);
      const ex = f.exam?.result;
      return `<button class="card feyn-card" data-act="feyn" data-id="${f.id}">
        <div class="fc-top"><span class="fc-n">#${f.n}</span><span class="fc-date">${shortDate(f.date)}</span></div>
        <div class="fc-title">${esc(f.topic || 'Без темы')}</div>
        <div class="fc-meta">
          ${node ? `<span>${icon('network')}${esc(node.name)}</span>` : ''}
          ${ex ? `<span class="exam ${ex.passed ? 'pass' : 'fail'}">${icon(ex.passed ? 'shield-check' : 'shield')}${ex.score}/10 ${ex.passed ? 'зачёт' : 'не зачёт'}</span>` : f.exam ? '<span class="exam">экзамен идёт</span>' : '<span class="exam none">без экзамена</span>'}
        </div>
      </button>`;
    }).join('') : '<div class="empty">Постов пока нет. Первый — «Как работает cache-aside»?</div>'}`;
}

function openFeyn(id) {
  const ex = id ? S.feynman.find(f => f.id === id) : null;
  const nextN = (S.feynman.reduce((m, f) => Math.max(m, f.n), 0)) + 1;
  const f = ex ? clone(ex) : { n: nextN, date: today(), topic: '', problem: '', solution: '', nuance: '', where: '', question: '', tags: '', node: '' };
  const nodeOpts = TREE.filter(b => !b.auto).map(b => `<optgroup label="${esc(b.name)}">${b.nodes.map(([nid, nm]) => `<option value="${nid}" ${f.node === nid ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</optgroup>`).join('');
  const sh = openSheet(`
    ${sheetHead(`Фейнман #${f.n}`, ex ? shortDate(f.date) : '')}
    <div class="field col"><span>Тема</span><input id="f-topic" placeholder="Transactional outbox" value="${esc(f.topic)}" autocomplete="off"></div>
    <div class="field"><span>Тема в дереве</span><select id="f-node"><option value="">—</option>${nodeOpts}</select></div>
    <div class="field col"><span>Проблема</span><textarea id="f-problem" rows="3" placeholder="Какую боль решает? Что сломается без этого?">${esc(f.problem)}</textarea></div>
    <div class="field col"><span>Решение</span><textarea id="f-solution" rows="4" placeholder="Как это работает — своими словами">${esc(f.solution)}</textarea></div>
    <div class="field col"><span>Нюанс</span><textarea id="f-nuance" rows="2" placeholder="Подводные камни, компромиссы">${esc(f.nuance)}</textarea></div>
    <div class="field col"><span>Где видел</span><input id="f-where" placeholder="У нас в банке…" value="${esc(f.where)}" autocomplete="off"></div>
    <div class="field col"><span>Вопрос на собесе</span><input id="f-question" placeholder="Как гарантировать, что событие не потеряется?" value="${esc(f.question)}" autocomplete="off"></div>
    <div class="field col"><span>Теги</span><input id="f-tags" placeholder="kafka sql" value="${esc(f.tags)}" autocomplete="off"></div>
    <div class="actions">
      ${ex ? `<button class="btn danger" id="f-del" aria-label="Удалить">${icon('trash-2')}</button><button class="btn" id="f-copy">${icon('copy')} Пост</button>` : ''}
      <button class="btn primary" id="f-save">Сохранить</button>
    </div>
    ${ex ? `<div id="exam"></div>` : `<p class="note">После сохранения можно сдать экзамен ИИ-интервьюеру.</p>`}`);
  const read = () => {
    for (const k of ['topic', 'problem', 'solution', 'nuance', 'where', 'question', 'tags']) f[k] = $(`#f-${k}`, sh).value.trim();
    f.node = $('#f-node', sh).value;
  };
  $('#f-save', sh).onclick = () => {
    read();
    if (!f.topic) return $('#f-topic', sh).focus();
    closeSheet();
    commit(() => {
      if (ex) S.feynman[S.feynman.findIndex(x => x.id === ex.id)] = { ...ex, ...f };
      else S.feynman.push({ ...f, id: uid(), exam: null });
    }, ex ? 'Пост обновлён' : `Фейнман #${f.n} готов`);
    if (!ex) { const saved = S.feynman[S.feynman.length - 1]; setTimeout(() => openFeyn(saved.id), 450); }
  };
  if (ex) {
    $('#f-del', sh).onclick = () => { closeSheet(); commit(() => { S.feynman = S.feynman.filter(x => x.id !== ex.id); }, `Фейнман #${f.n} удалён`); };
    $('#f-copy', sh).onclick = () => { read(); copyText(feynPost(f)); };
    paintExam(sh, ex.id);
  }
}

function paintExam(sh, id) {
  const box = $('#exam', sh);
  const f = S.feynman.find(x => x.id === id);
  const e = f.exam;
  if (!AI.ready) { box.innerHTML = `<div class="exam-box"><h4>${icon('graduation-cap')} Экзамен</h4><p class="note">Добавь ключ OpenAI в настройках, чтобы сдать экзамен ИИ-интервьюеру.</p></div>`; return; }
  if (!e) {
    box.innerHTML = `<div class="exam-box"><h4>${icon('graduation-cap')} Экзамен у ИИ-интервьюера</h4>
      <p class="note">Он найдёт неточности и задаст 3 вопроса, как на собесе Middle Go в inDrive. Зачёт (7+) — ⭐⭐ теме в дереве и до +50 XP.</p>
      <button class="btn ai wide" id="ex-start">${icon('wand-sparkles')} Сдать экзамен</button></div>`;
    $('#ex-start', box).onclick = async ev => {
      const btn = ev.currentTarget;
      busy(btn, true);
      try {
        const r = await AI.examStart(f);
        const exam = { score1: r.score, good: r.good || '', issues: r.issues || [], questions: (r.questions || []).slice(0, 3), answers: [], result: null };
        commit(() => { S.feynman.find(x => x.id === id).exam = exam; }, 'Интервьюер задал вопросы');
        paintExam(sh, id);
      } catch (err) { toast(err.message); busy(btn, false); }
    };
    return;
  }
  const qa = e.questions.map((q, i) => ({ q, a: e.answers[i] || '' }));
  box.innerHTML = `<div class="exam-box">
    <h4>${icon('graduation-cap')} Экзамен · объяснение ${e.score1}/10</h4>
    ${e.good ? `<p class="ex-good">${icon('check')} ${esc(e.good)}</p>` : ''}
    ${e.issues.length ? `<ul class="ex-issues">${e.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${qa.map((x, i) => {
      const v = e.result?.answers?.[i];
      return `<div class="ex-q">
        <b>${i + 1}. ${esc(x.q)}</b>
        <textarea rows="3" data-qa="${i}" placeholder="Ответь как на собесе — можно голосом" ${e.result ? 'readonly' : ''}>${esc(x.a)}</textarea>
        ${v ? `<p class="ex-v ${v.verdict === 'верно' ? 'ok' : v.verdict === 'частично' ? 'mid' : 'bad'}"><b>${esc(v.verdict)}</b> — ${esc(v.comment)}</p>` : ''}
      </div>`;
    }).join('')}
    ${e.result ? `<div class="ex-result ${e.result.passed ? 'pass' : 'fail'}">
        ${icon(e.result.passed ? 'shield-check' : 'shield')}
        <div><b>${e.result.score}/10 · ${e.result.passed ? 'Зачёт' : 'Пока не зачёт'}</b><p>${esc(e.result.summary || '')}</p></div>
      </div>
      <button class="btn wide" id="ex-retry">${icon('wand-sparkles')} Пересдать</button>`
    : `<button class="btn ai wide" id="ex-send">${icon('send')} Отправить ответы</button>`}
  </div>`;
  $('#ex-send', box)?.addEventListener('click', async ev => {
    const answers = $$('[data-qa]', box).map(t => t.value.trim());
    const btn = ev.currentTarget;
    busy(btn, true);
    try {
      const r = await AI.examFinish(f, e.questions.map((q, i) => ({ q, a: answers[i] })));
      const score = Math.max(0, Math.min(10, Math.round(+r.score || 0)));
      commit(() => {
        const x = S.feynman.find(y => y.id === id);
        x.exam = { ...x.exam, answers, result: { score, passed: !!r.passed && score >= 7, answers: r.answers || [], summary: r.summary || '' } };
      }, score >= 7 ? `Зачёт: ${score}/10` : `Экзамен: ${score}/10`);
      paintExam(sh, id);
    } catch (err) { toast(err.message); busy(btn, false); }
  });
  $('#ex-retry', box)?.addEventListener('click', () => {
    commit(() => { S.feynman.find(y => y.id === id).exam = null; }, 'Экзамен сброшен');
    paintExam(sh, id);
  });
}

/* =========================================================
   Skill tree
   ========================================================= */
function renderTree(C) {
  const tp = C.tp;
  const lcc = lcByTopic();
  view.innerHTML = `
    <section class="card tree-head">
      <div class="th-pct">${Math.round(tp.pct * 100)}<small>%</small></div>
      <div><b>${esc(S.profile.goal)}</b><p>${tp.stars} из ${tp.max} звёзд · каждая ручная звезда +25 XP</p>
      <div class="legend-stars"><span>${icon('star')} изучил</span><span>${icon('star')}${icon('star')} объяснил</span><span>${icon('star')}${icon('star')}${icon('star')} применил</span></div></div>
    </section>
    ${TREE.map(b => {
      const bp = tp.byBranch[b.id];
      return `<section class="card branch">
        <div class="br-head">${icon(b.icon)}<h3>${esc(b.name)}</h3><span>${bp.stars}/${bp.max}</span></div>
        <div class="br-bar"><i style="width:${(bp.stars / bp.max) * 100}%"></i></div>
        ${b.auto ? '<p class="note">Звёзды из LeetCode: 1, 5 и 15 решённых задач по теме</p>' : ''}
        ${b.nodes.map(([id, name]) => {
          const node = TREE_NODES.find(n => n.id === id);
          const st = nodeStars(node, lcc);
          const star = (k, title) => node.auto || ((k === 'f' || k === 's') && st.fAuto)
            ? `<span class="star ${st[k] ? 'on' : ''} locked" title="${title}">${icon('star')}</span>`
            : `<button class="star ${st[k] ? 'on' : ''}" data-act="star" data-node="${id}" data-k="${k}" aria-label="${title}">${icon('star')}</button>`;
          return `<div class="node ${st.s && st.f && st.a ? 'full' : ''}">
            <span class="nd-name">${esc(name)}${node.auto ? `<small>${st.n} ${plural(st.n, ['задача', 'задачи', 'задач'])}</small>` : st.fAuto ? '<small>зачёт у ИИ</small>' : ''}</span>
            <span class="stars">${star('s', 'Изучил')}${star('f', 'Объяснил')}${star('a', 'Применил')}</span>
          </div>`;
        }).join('')}
      </section>`;
    }).join('')}`;
}

function toggleStar(id, k) {
  const name = TREE_NODES.find(n => n.id === id)?.name;
  const on = !(S.tree[id] || {})[k];
  commit(() => { S.tree[id] = { ...(S.tree[id] || {}), [k]: on }; }, on ? `${name}: ${{ s: 'изучил', f: 'объяснил', a: 'применил' }[k]}` : 'Звезда снята');
}

/* =========================================================
   Hero (stats, achievements, shop, journal)
   ========================================================= */
function renderHero(C) {
  const statRows = XP_STATS.map(k => {
    const xp = C.by[k] || 0, L = statLevelOf(xp), a = statLevelStart(L), b = statLevelStart(L + 1);
    return `<div class="stat" style="--c:${STATS[k].color}">
      <span class="st-ic">${icon(STATS[k].icon)}</span>
      <div class="st-main"><div class="st-top"><b>${STATS[k].name}</b><span>ур. ${L} · ${num(xp)} XP</span></div>
      <div class="st-bar"><i style="width:${((xp - a) / (b - a)) * 100}%"></i></div></div>
    </div>`;
  }).join('');
  const en = C.energy;
  const unlocked = new Set(C.ach.map(a => a.id));
  const days = Object.keys(S.days).sort().reverse();
  view.innerHTML = `
    ${heroCard(C)}
    <section class="card">
      <h3 class="card-title">Характеристики</h3>
      ${statRows}
      <div class="stat" style="--c:${STATS.energy.color}">
        <span class="st-ic">${icon('battery')}</span>
        <div class="st-main"><div class="st-top"><b>Энергия</b><span>${en ? `сон ${dec(en.avg)} ч в среднем` : 'нет данных'}</span></div>
        <div class="st-bar"><i style="width:${en ? en.pct : 0}%"></i></div></div>
      </div>
      <p class="note">Энергия — средний сон за последние 7 записей. 7+ ч дают ×1.2 к опыту дня, меньше 6 — штраф.</p>
    </section>

    <section class="card">
      <h3 class="card-title">Ачивки <span>${C.ach.length}/${ACH.length}</span></h3>
      <div class="ach-grid">${ACH.map(a => `<div class="ach ${unlocked.has(a.id) ? 'on' : ''}">
        <span class="ach-ic">${icon(unlocked.has(a.id) ? a.icon : 'lock')}</span>
        <b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
      </div>`).join('')}</div>
    </section>

    <section class="card">
      <h3 class="card-title">Магазин наград <span class="coin-pill static">${icon('coins')}${num(C.coins)}</span></h3>
      <p class="note">Монеты = заработанный опыт минус покупки. Награды придумываешь ты.</p>
      <div class="shop">${S.rewards.map(r => `<div class="reward">
        <button class="rw-main" data-act="reward-edit" data-id="${r.id}"><span class="rw-ic">${icon(r.icon)}</span><span>${esc(r.name)}</span></button>
        <button class="buy" data-act="buy" data-id="${r.id}" ${C.coins < r.cost ? 'disabled' : ''}>${icon('coins')}${num(r.cost)}</button>
      </div>`).join('')}</div>
      <button class="btn wide" data-act="reward-edit">${icon('plus')} Своя награда</button>
      ${S.purchases.length ? `<div class="label">Куплено</div><div class="facts">${S.purchases.slice(-5).reverse().map(p => `<div><span>${esc(p.name)} · ${shortDate(p.date)}</span><b>−${num(p.cost)}</b></div>`).join('')}</div>` : ''}
    </section>

    <section class="card">
      <h3 class="card-title">Дневник <span>${days.length} ${plural(days.length, ['запись', 'записи', 'записей'])}</span></h3>
      ${days.length ? `<div class="journal">${days.slice(0, UI.journal).map(d => {
        const e = S.days[d], x = dayXP(d);
        return `<button class="jrow" data-act="day" data-date="${d}">
          <span class="j-n">${dayN(d)}</span>
          <span class="j-main"><b>${wdDate(d)}</b><small>${esc(e.pleasant || e.annoying || Object.keys(e.acts || {}).map(id => actById(id)?.name).filter(Boolean).join(', ') || '—')}</small></span>
          <span class="j-rate">${e.rating ?? '—'}<small>/10</small></span>
          <span class="j-xp">+${num(x.total)}</span>
        </button>`;
      }).join('')}</div>${days.length > UI.journal ? '<button class="btn wide" data-act="more">Показать ещё</button>' : ''}` : '<div class="empty">Пока пусто</div>'}
    </section>`;
}

function buyReward(id) {
  const r = S.rewards.find(x => x.id === id);
  if (!r) return;
  if (computeAll().coins < r.cost) return toast('Не хватает монет');
  commit(() => { S.purchases.push({ id: uid(), reward: r.id, name: r.name, cost: r.cost, date: today() }); }, `Куплено: ${r.name} · −${num(r.cost)} 🪙`);
}

const REWARD_ICONS = ['gift', 'gamepad-2', 'utensils', 'pizza', 'coffee', 'bed', 'tv', 'music', 'headphones', 'plane', 'bike', 'shopping-bag', 'gem', 'crown', 'party-popper', 'camera', 'heart', 'mountain'];
function openReward(id) {
  const ex = id ? S.rewards.find(r => r.id === id) : null;
  const r = ex ? clone(ex) : { name: '', icon: 'gift', cost: 300 };
  const sh = openSheet(`
    ${sheetHead(ex ? 'Награда' : 'Новая награда')}
    <div class="field"><span>Что</span><input id="w-name" placeholder="Кино с друзьями" value="${esc(r.name)}" autocomplete="off"></div>
    <div class="field"><span>Цена в монетах</span><input id="w-cost" inputmode="numeric" value="${r.cost}"></div>
    <div class="label">Иконка</div>
    <div class="icon-grid" id="w-icons">${REWARD_ICONS.map(n => `<button type="button" data-icon="${n}" class="${n === r.icon ? 'on' : ''}">${icon(n)}</button>`).join('')}</div>
    <p class="note">Ориентир: обычный день приносит 60–150 XP.</p>
    <div class="actions">
      ${ex ? `<button class="btn danger" id="w-del" aria-label="Удалить">${icon('trash-2')}</button>` : ''}
      <button class="btn primary" id="w-save">Сохранить</button>
    </div>`);
  $('#w-icons', sh).onclick = e => { const b = e.target.closest('[data-icon]'); if (!b) return; r.icon = b.dataset.icon; $$('#w-icons button', sh).forEach(x => x.classList.toggle('on', x === b)); };
  $('#w-save', sh).onclick = () => {
    const name = $('#w-name', sh).value.trim();
    if (!name) return $('#w-name', sh).focus();
    const rec = { id: ex?.id || uid(), name, icon: r.icon, cost: Math.max(1, +$('#w-cost', sh).value || 1) };
    closeSheet();
    commit(() => { if (ex) S.rewards[S.rewards.findIndex(x => x.id === ex.id)] = rec; else S.rewards.push(rec); }, 'Награда сохранена');
  };
  if (ex) $('#w-del', sh).onclick = () => { closeSheet(); commit(() => { S.rewards = S.rewards.filter(x => x.id !== ex.id); }, 'Награда удалена'); };
}

/* =========================================================
   Settings
   ========================================================= */
function openSettings() {
  const p = S.profile;
  const sh = openSheet(`
    ${sheetHead('Настройки')}
    <div class="label">Профиль</div>
    <div class="field"><span>Имя</span><input id="s-name" value="${esc(p.name)}" placeholder="Герой" autocomplete="off"></div>
    <div class="field col"><span>Главный квест</span><input id="s-goal" value="${esc(p.goal)}" autocomplete="off"></div>
    <div class="field"><span>Дедлайн</span><input type="date" id="s-deadline" value="${p.deadline}"></div>
    <div class="field"><span>Сегодня — день №</span><input id="s-dayn" inputmode="numeric" value="${dayN(today())}"></div>

    <div class="label">ИИ (OpenAI)</div>
    <div class="field"><span>Ключ API</span><input id="s-key" type="password" value="${esc(AI.key)}" placeholder="sk-…" autocomplete="off" spellcheck="false"></div>
    <div class="field"><span>Модель</span><input id="s-model" value="${esc(AI.model)}" autocomplete="off" spellcheck="false"></div>
    <p class="note">Ключ хранится только на этом телефоне и не попадает в резервную копию. Создай отдельный ключ и поставь месячный лимит трат в кабинете OpenAI. Записи уходят в OpenAI, только когда ты нажимаешь кнопку с ИИ.</p>

    <div class="label">Занятия в дневнике</div>
    <div class="list">${S.activities.map(a => `<button class="lrow" data-actv="${a.id}" style="--c:${STATS[a.stat]?.color || 'var(--text-3)'}">
      <span class="l-ic">${icon(a.icon)}</span><span class="l-main">${esc(a.name)}<small>${a.stat ? STATS[a.stat].name : 'без опыта'}${a.xp ? ` · ${a.timed ? `${a.xp} XP/ч` : `+${a.xp} XP`}` : ''}</small></span>${icon('chevron-right')}
    </button>`).join('')}</div>
    <button class="btn wide" id="s-act-add">${icon('plus')} Занятие</button>

    <div class="label">Резервная копия</div>
    <div class="list">
      <button class="lrow" id="s-export"><span class="l-ic">${icon('download')}</span><span class="l-main">Сохранить копию<small>${S.lastBackup ? 'последняя: ' + shortDate(S.lastBackup.slice(0, 10)) : 'ещё не было'}</small></span></button>
      <button class="lrow" id="s-import"><span class="l-ic">${icon('upload')}</span><span class="l-main">Восстановить из копии</span></button>
      <button class="lrow danger" id="s-reset"><span class="l-ic">${icon('trash-2')}</span><span class="l-main">Стереть всё</span></button>
    </div>
    <p class="note">Данные живут только на этом iPhone. Удалишь иконку с экрана «Домой» — пропадут. Сохраняй копию в «Файлы» раз в неделю — например, после ретро.</p>
    <div class="actions"><button class="btn primary" id="s-save">Сохранить</button></div>`);

  const readProfile = () => {
    const n = Math.max(1, +$('#s-dayn', sh).value || 1);
    return { name: $('#s-name', sh).value.trim(), goal: $('#s-goal', sh).value.trim() || p.goal, deadline: $('#s-deadline', sh).value || p.deadline, day1: addDays(today(), -(n - 1)) };
  };
  $('#s-save', sh).onclick = () => {
    AI.key = $('#s-key', sh).value.trim();
    AI.model = $('#s-model', sh).value.trim();
    const np = readProfile();
    closeSheet();
    commit(() => { Object.assign(S.profile, np); }, 'Настройки сохранены');
  };
  sh.addEventListener('click', e => { const r = e.target.closest('[data-actv]'); if (r) openActivity(r.dataset.actv); });
  $('#s-act-add', sh).onclick = () => openActivity();
  $('#s-export', sh).onclick = exportData;
  $('#s-import', sh).onclick = () => $('#import-file').click();
  $('#s-reset', sh).onclick = () => {
    if (!confirm('Стереть ВСЕ данные игры?\n\nСовет: сначала сохрани копию.')) return;
    closeSheet();
    const undo = snapshot();
    S = fresh();
    save();
    render();
    toast('Всё стёрто', undo);
    setTimeout(onboarding, 300);
  };
}

const ACT_ICONS = ['briefcase', 'book-open', 'dumbbell', 'trophy', 'volleyball', 'users', 'footprints', 'code', 'rocket', 'sparkles', 'gamepad-2', 'bike', 'mountain', 'music', 'pen-tool', 'palette', 'camera', 'heart', 'coffee', 'map-pin', 'laptop', 'graduation-cap', 'message-circle', 'tv', 'headphones', 'plane', 'sun', 'moon'];
function openActivity(id) {
  const ex = id ? actById(id) : null;
  const a = ex ? clone(ex) : { id: uid(), name: '', icon: 'sparkles', stat: 'novelty', xp: 20, tag: '', timed: false };
  const sh = openSheet(`
    ${sheetHead(ex ? 'Занятие' : 'Новое занятие')}
    <div class="field"><span>Название</span><input id="a-name" value="${esc(a.name)}" placeholder="Бег" autocomplete="off"></div>
    <div class="field"><span>Характеристика</span><select id="a-stat"><option value="">Без опыта</option>${XP_STATS.map(k => `<option value="${k}" ${a.stat === k ? 'selected' : ''}>${STATS[k].name}</option>`).join('')}</select></div>
    <div class="field"><span>Опыт</span><input id="a-xp" inputmode="numeric" value="${a.xp}"></div>
    <div class="field"><span>Считать по времени <small>(опыт за час)</small></span><input type="checkbox" class="switch" id="a-timed" ${a.timed ? 'checked' : ''}></div>
    <div class="field"><span>Тег для поста</span><input id="a-tag" value="${esc(a.tag)}" placeholder="run" autocomplete="off"></div>
    <div class="label">Иконка</div>
    <div class="icon-grid" id="a-icons">${ACT_ICONS.map(n => `<button type="button" data-icon="${n}" class="${n === a.icon ? 'on' : ''}">${icon(n)}</button>`).join('')}</div>
    <div class="actions">
      ${ex ? `<button class="btn danger" id="a-del" aria-label="Удалить">${icon('trash-2')}</button>` : ''}
      <button class="btn" id="a-back">Назад</button>
      <button class="btn primary" id="a-save">Сохранить</button>
    </div>`);
  $('#a-icons', sh).onclick = e => { const b = e.target.closest('[data-icon]'); if (!b) return; a.icon = b.dataset.icon; $$('#a-icons button', sh).forEach(x => x.classList.toggle('on', x === b)); };
  $('#a-back', sh).onclick = openSettings;
  $('#a-save', sh).onclick = () => {
    const name = $('#a-name', sh).value.trim();
    if (!name) return $('#a-name', sh).focus();
    const rec = { id: a.id, name, icon: a.icon, stat: $('#a-stat', sh).value, xp: Math.max(0, +$('#a-xp', sh).value || 0), tag: $('#a-tag', sh).value.trim(), timed: $('#a-timed', sh).checked };
    commit(() => { if (ex) S.activities[S.activities.findIndex(x => x.id === ex.id)] = rec; else S.activities.push(rec); }, 'Занятие сохранено');
    openSettings();
  };
  if (ex) $('#a-del', sh).onclick = () => {
    commit(() => { S.activities = S.activities.filter(x => x.id !== ex.id); }, 'Занятие удалено');
    openSettings();
  };
}

/* ---------- onboarding ---------- */
function onboarding() {
  const sh = openSheet(`
    <div class="onb">
      <div class="onb-ic">${icon('swords')}</div>
      <h2>Добро пожаловать в игру</h2>
      <p>Твоя жизнь — RPG. Записи дня, LeetCode, спринты и посты Фейнмана качают персонажа к главному квесту.</p>
    </div>
    <div class="field"><span>Как тебя зовут?</span><input id="o-name" placeholder="Имя" autocomplete="off"></div>
    <div class="field"><span>Сегодня день № <small>(по твоему счёту)</small></span><input id="o-dayn" inputmode="numeric" placeholder="1"></div>
    <div class="field"><span>Какой спринт планируешь следующим?</span><input id="o-sprint" inputmode="numeric" placeholder="1"></div>
    <div class="field col"><span>Главный квест</span><input id="o-goal" value="${esc(S.profile.goal)}" autocomplete="off"></div>
    <div class="field"><span>Дедлайн</span><input type="date" id="o-deadline" value="${S.profile.deadline}"></div>
    <p class="note">Ключ OpenAI для ИИ-функций можно добавить потом в «Герой» → ⚙︎.</p>
    <div class="actions"><button class="btn primary" id="o-go">${icon('swords')} Начать игру</button></div>`);
  $('#o-go', sh).onclick = () => {
    const n = Math.max(1, +$('#o-dayn', sh).value || 1);
    Object.assign(S.profile, {
      name: $('#o-name', sh).value.trim(),
      day1: addDays(today(), -(n - 1)),
      nextSprint: Math.max(1, +$('#o-sprint', sh).value || 1),
      goal: $('#o-goal', sh).value.trim() || S.profile.goal,
      deadline: $('#o-deadline', sh).value || S.profile.deadline,
      onboarded: true,
    });
    save();
    closeSheet();
    render();
  };
}

/* =========================================================
   Posts in your Telegram format
   ========================================================= */
function dayPost(date) {
  const e = S.days[date];
  const did = Object.entries(e.acts || {}).map(([id, v]) => {
    const a = actById(id);
    if (!a) return '';
    const m = actMinutes(a, v);
    return a.name.toLowerCase().replace(/^dota$/, 'Dota') + (a.timed ? ` ${m >= 60 ? dec(m / 60) + ' ч' : m + ' мин'}` : '');
  }).filter(Boolean);
  if (e.studied) did.push(e.studied);
  const lcN = S.lc.filter(t => t.date === date).length;
  if (lcN) did.push(`${lcN} ${plural(lcN, ['задача', 'задачи', 'задач'])} LeetCode`);
  const tags = ['день', ...(e.tags || defaultTags(e, date)).split(/[\s,#]+/).filter(Boolean)];
  return [
    `День ${dayN(date)}`,
    `Оценка: ${e.rating}/10, сон ${dec(e.sleep)} ч`,
    e.pleasant && `Приятно: ${e.pleasant}`,
    e.annoying && `Раздражало: ${e.annoying}`,
    did.length && `Делал: ${did.join(', ')}`,
    [...new Set(tags)].map(t => '#' + t).join(' '),
  ].filter(Boolean).join('\n');
}

// Lines: null = skip, '' = blank separator line
const when = (cond, str) => (cond ? str : null);
const joinLines = arr => arr.filter(x => x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

function weekPost(sp, retro = sp.retro || {}) {
  const w = weekStats(sp);
  const next = S.sprints.find(s => s.n === sp.n + 1);
  const wd = ds => ds.map(d => WD[dateOf(d).getDay()]).join(', ');
  const lines = [
    next ? `Спринт ${sp.n} → Спринт ${next.n}` : `Спринт ${sp.n}`, '',
    `Ретро спринта ${sp.n}`,
    `План: ${sp.goals.map(g => g.type === 'lc' ? `${g.target} задач LeetCode` : g.text).join(', ')}`,
    `Сделано: ${sp.goals.map(g => `${g.type === 'lc' ? 'LeetCode' : g.text} ${goalMark(sp, g)}`).join(', ')}`,
    when(retro.hindered, `Что мешало: ${retro.hindered}`),
    when(retro.worked, `Что сработало: ${retro.worked}`), '',
    'Неделя по дневнику',
    when(w.avg != null, `Средняя оценка: ${dec(w.avg)}/10`),
    when(w.best.length, `Лучшие дни: ${wd(w.best)}`),
    when(w.worst.length, `Худшие: ${wd(w.worst)}`),
    when(retro.conclusion, `Вывод: ${retro.conclusion}`),
    `Сделал: ${w.spheres.map(x => `${STATS[x.s].name.toLowerCase()} ${x.mark}${x.names.length ? ` (${x.names.join(', ')})` : ''}`).join(', ')}`,
  ];
  if (next) {
    const by = t => next.goals.filter(g => g.type === t);
    const lcTopic = g => g.text.replace(/^LeetCode\s*/i, '').replace(/^\(|\)$/g, '').trim();
    lines.push('', `План спринта ${next.n}`,
      when(by('topic').length, `Темы: ${by('topic').map(g => g.text).join('; ')}`),
      when(by('lc').length, `LeetCode: ${by('lc').map(g => `${g.target} задач${lcTopic(g) ? ` (${lcTopic(g)})` : ''}`).join('; ')}`),
      when(by('feynman').length, `Фейнман в субботу: ${by('feynman').map(g => g.text).join('; ')}`),
      when(by('life').length, `Жизнь: ${by('life').map(g => g.text).join('; ')}`));
  }
  lines.push('#неделя');
  return joinLines(lines);
}

function feynPost(f) {
  const tags = ['фейнман', ...(f.tags || '').split(/[\s,#]+/).filter(Boolean)];
  return joinLines([
    `Фейнман #${f.n}: ${f.topic}`, '',
    when(f.problem, `Проблема. ${f.problem}`), when(f.problem, ''),
    when(f.solution, `Решение. ${f.solution}`), when(f.solution, ''),
    when(f.nuance, `Нюанс. ${f.nuance}`), when(f.nuance, ''),
    when(f.where, `Где видел: ${f.where}`),
    when(f.question, `Вопрос на собесе: «${(f.question || '').replace(/^«|»$/g, '')}»`),
    [...new Set(tags)].map(t => '#' + t).join(' '),
  ]);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Пост скопирован — вставь в Telegram');
}

/* =========================================================
   Sheet, toast, celebrations
   ========================================================= */
const sheetRoot = $('#sheet');
let sheetTimer = null;
function openSheet(html) {
  clearTimeout(sheetTimer);
  sheetRoot.innerHTML = `<div class="backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  sheetRoot.hidden = false;
  sheetRoot.classList.remove('open');
  void sheetRoot.offsetHeight;
  sheetRoot.classList.add('open');
  const sh = sheetRoot.querySelector('.sheet');
  sh.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  return sh;
}
function closeSheet() {
  document.activeElement?.blur?.();
  sheetRoot.classList.remove('open');
  sheetTimer = setTimeout(() => { sheetRoot.hidden = true; sheetRoot.innerHTML = ''; }, 280);
}
sheetRoot.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
const sheetHead = (title, sub = '') => `<div class="sheet-head"><div><h2>${esc(title)}</h2>${sub ? `<span>${esc(sub)}</span>` : ''}</div><button class="icon-btn" data-close aria-label="Закрыть">${icon('x')}</button></div>`;

if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => document.documentElement.style.setProperty('--kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px');
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
}

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="undo">Отменить</button>' : ''}`;
  t.classList.toggle('has-undo', !!undo);
  t.hidden = false;
  if (undo) t.querySelector('.undo').onclick = () => { undo(); toast('Отменено'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 5000 : 2200);
}

function celebrate(level) {
  const el = $('#levelup');
  el.innerHTML = `<div class="lu-card"><div class="lu-ring">${level}</div><b>Новый уровень!</b><span>Ты теперь ${level} уровня</span></div>`;
  el.hidden = false;
  navigator.vibrate?.([20, 40, 20]);
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 2200);
}
$('#levelup').addEventListener('click', e => (e.currentTarget.hidden = true));

function achPop(a) {
  const el = $('#achpop');
  el.innerHTML = `<span class="ap-ic">${icon(a.icon)}</span><div><small>Ачивка открыта · +50 XP</small><b>${esc(a.name)}</b></div>`;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 2400);
}

/* =========================================================
   Backup
   ========================================================= */
async function exportData() {
  S.lastBackup = new Date().toISOString();
  save();
  const name = `quest-backup-${today()}.json`;
  const file = new File([JSON.stringify(S, null, 1)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('#import-file').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!valid(d)) throw new Error('bad');
      if (!confirm(`Заменить все данные этой копией?\n\nДней: ${Object.keys(d.days).length}, задач: ${d.lc.length}, спринтов: ${d.sprints.length}.`)) return;
      closeSheet();
      const undo = snapshot();
      S = normalize(d);
      save();
      render();
      toast('Данные восстановлены', undo);
    } catch (err) { toast('Этот файл не похож на копию'); }
  };
  r.readAsText(f);
});

/* =========================================================
   Events
   ========================================================= */
const ACTIONS = {
  tab: el => setTab(el.dataset.tab),
  day: el => openDay(el.dataset.date),
  'copy-day': el => copyText(dayPost(el.dataset.date)),
  lc: el => openLC(el.dataset.diff),
  plan: el => openPlanner(el.dataset.id),
  goal: el => toggleGoal(el.dataset.sp, el.dataset.g),
  retro: el => openRetro(el.dataset.id),
  'copy-week': el => {
    const next = S.sprints.find(s => s.id === el.dataset.id);
    const prev = S.sprints.find(s => s.n === next.n - 1);
    if (!prev) return toast('Нет прошлого спринта для ретро');
    copyText(weekPost(prev));
  },
  'feyn-new': () => openFeyn(),
  feyn: el => openFeyn(el.dataset.id),
  star: el => toggleStar(el.dataset.node, el.dataset.k),
  settings: openSettings,
  buy: el => buyReward(el.dataset.id),
  'reward-edit': el => openReward(el.dataset.id),
  more: () => { UI.journal += 30; render(); },
};

document.addEventListener('click', e => {
  if (sheetRoot.contains(e.target) || $('#toast').contains(e.target)) return;
  const tab = e.target.closest('#tabbar [data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  // inner buttons win over the clickable card around them
  const a = e.target.closest('[data-act]');
  if (a) ACTIONS[a.dataset.act]?.(a, e);
});

$$('#tabbar button').forEach(b => {
  b.querySelector('svg').outerHTML = icon({ today: 'house', tree: 'network', feynman: 'lightbulb', hero: 'shield' }[b.dataset.tab]);
});

let renderedDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && today() !== renderedDay) { renderedDay = today(); render(); }
});

render();
if (!S.profile.onboarded) onboarding();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
