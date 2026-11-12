/* Questlog core logic — shared by the window (renderer) and the background process (main).
   Pure functions over a plain JSON state; no DOM, no Node APIs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const dow = (k) => parseKey(k).getDay(); // 0 = Sunday
  const weekStart = (k) => addDays(k, -((dow(k) + 6) % 7)); // Monday
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------- constants ----------
  const LADDERS = {
    JLPT: { label: 'JLPT', levels: ['N5', 'N4', 'N3', 'N2', 'N1'], hours: [400, 350, 500, 900, 1700] },
    HSK: { label: 'HSK', levels: ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6'], hours: [150, 150, 300, 400, 600, 1000] },
    CEFR: { label: 'CEFR', levels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], hours: [100, 100, 200, 200, 200, 400] },
  };
  const XP = { perMin: 1, perUnit: 10, dayBonus: 15, weekBonus: 60, task: 40, target: 150, early: 50, ladder: 250 };
  const TITLES = [[1, 'Novice'], [3, 'Apprentice'], [5, 'Adept'], [8, 'Scholar'], [12, 'Expert'], [16, 'Master'], [20, 'Sage'], [25, 'Legend']];

  const ACHIEVEMENTS = [
    { id: 'first_log', icon: '🌱', name: 'First Step', desc: 'Log progress for the first time' },
    { id: 'streak3', icon: '🔥', name: 'Warming Up', desc: 'Stay active 3 days in a row' },
    { id: 'streak7', icon: '🔥', name: 'One Full Week', desc: 'Stay active 7 days in a row' },
    { id: 'streak30', icon: '🌋', name: 'Unstoppable', desc: 'Stay active 30 days in a row' },
    { id: 'streak100', icon: '☄️', name: 'Centurion', desc: 'Stay active 100 days in a row' },
    { id: 'hours10', icon: '⏱️', name: '10 Hours In', desc: 'Log 10 hours in total' },
    { id: 'hours50', icon: '⌛', name: 'Half a Hundred', desc: 'Log 50 hours in total' },
    { id: 'hours100', icon: '💯', name: 'Hundred Hours', desc: 'Log 100 hours in total' },
    { id: 'hours500', icon: '🏔️', name: 'Summit', desc: 'Log 500 hours in total' },
    { id: 'polyglot', icon: '🗣️', name: 'Polyglot Day', desc: 'Practise three languages in one day' },
    { id: 'perfect_day', icon: '⭐', name: 'Perfect Day', desc: 'Finish every daily goal scheduled for a day' },
    { id: 'perfect_week', icon: '🌟', name: 'Perfect Week', desc: 'Seven perfect days in a row' },
    { id: 'marathon', icon: '🏃', name: 'Marathon', desc: 'Log 3 hours in a single day' },
    { id: 'early_bird', icon: '🌅', name: 'Early Bird', desc: 'Log progress before 8 in the morning' },
    { id: 'night_owl', icon: '🦉', name: 'Night Owl', desc: 'Log progress after 11 at night' },
    { id: 'task1', icon: '✅', name: 'Checked Off', desc: 'Complete a one-off task' },
    { id: 'task10', icon: '📋', name: 'Finisher', desc: 'Complete 10 one-off tasks' },
    { id: 'deadline', icon: '🎯', name: 'Deadline Crusher', desc: 'Hit a target on or before its deadline' },
    { id: 'levelup', icon: '🎓', name: 'Level Up', desc: 'Reach a new exam level in a language' },
    { id: 'lvl5', icon: '🥉', name: 'Adept', desc: 'Reach player level 5' },
    { id: 'lvl10', icon: '🥈', name: 'Seasoned', desc: 'Reach player level 10' },
    { id: 'lvl25', icon: '🥇', name: 'Legend', desc: 'Reach player level 25' },
  ];

  // ---------- state ----------
  function defaultSettings() {
    return {
      autostart: false, startHidden: true, theme: 'system',
      remindersOn: true, summaryOn: true, summaryTime: '21:00',
      deadlineOn: true, achievementsOn: true,
    };
  }

  function newGoal(partial) {
    return Object.assign({
      id: uid(), name: '', icon: '★', slot: 0, category: 'other', type: 'habit',
      unit: 'min', target: 30, period: 'day', days: [0, 1, 2, 3, 4, 5, 6],
      total: 10, startDate: null, deadline: null,
      due: null, doneDate: null,
      reminder: '', xpPerUnit: XP.perUnit, ladder: null,
      createdAt: null, archived: false,
    }, partial);
  }

  function newLadder(scale, current, target) {
    const L = LADDERS[scale];
    const cur = current == null ? -1 : current;
    return {
      scale, current: cur, target: target == null ? L.levels.length - 1 : target,
      since: null, hoursNext: L.hours[Math.min(cur + 1, L.hours.length - 1)], history: [],
    };
  }

  function defaultState(now) {
    const today = dateKey(now || new Date());
    const sunday = addDays(weekStart(today), 6);
    let n = 0; const mk = (p) => newGoal(Object.assign({ createdAt: today }, p, { id: 'default-' + (++n) }));
    const lang = (name, icon, slot, scale, target) => {
      const g = mk({ name, icon, slot, category: 'language', type: 'habit', unit: 'min', target: 30, period: 'day' });
      g.ladder = newLadder(scale, -1, target); g.ladder.since = today; return g;
    };
    return {
      version: 1,
      settings: defaultSettings(),
      goals: [
        lang('Japanese', 'あ', 0, 'JLPT', 2),
        lang('Chinese', '中', 1, 'HSK', 3),
        lang('English', 'En', 2, 'CEFR', 4),
        mk({ name: 'Coursework: focused work', icon: '✍️', slot: 3, category: 'study', type: 'habit', unit: 'min', target: 30, period: 'day' }),
        mk({ name: 'Write 10 pages of coursework', icon: '📄', slot: 4, category: 'study', type: 'target', unit: 'pages', total: 10, startDate: today, deadline: sunday, xpPerUnit: 20 }),
        mk({ name: 'Read a book', icon: '📖', slot: 5, category: 'reading', type: 'habit', unit: 'min', target: 30, period: 'day' }),
      ],
      logs: [],
      achievements: {},
      deleted: {},
      timer: null,
      createdAt: today,
    };
  }

  function normalize(state) {
    const base = defaultState();
    if (!state || typeof state !== 'object' || !Array.isArray(state.goals)) return base;
    state.settings = Object.assign(defaultSettings(), state.settings || {});
    state.goals = state.goals.map((g) => newGoal(g));
    state.logs = Array.isArray(state.logs) ? state.logs.filter((l) => l && l.goalId && l.date && l.amount > 0) : [];
    state.achievements = state.achievements || {};
    state.deleted = state.deleted || {};
    if (state.timer === undefined) state.timer = null;
    state.createdAt = state.createdAt || dateKey(new Date());
    state.version = 1;
    return state;
  }

  // ---------- sync (record-level merge between devices) ----------
  // Only goals, log entries, deletions and achievements travel between devices.
  // Settings, the running timer and the sync credentials stay on each device.
  const touch = (g) => { g.updatedAt = Date.now(); return g; };
  const syncDoc = (state) => ({ v: 1, goals: state.goals, logs: state.logs, deleted: state.deleted || {}, achievements: state.achievements || {} });
  const validDoc = (d) => !!d && Array.isArray(d.goals) && Array.isArray(d.logs);
  // A device nobody has used yet: untouched example goals, nothing logged, nothing deleted.
  const isPristine = (state) => !state.logs.length && !Object.keys(state.deleted || {}).length && state.goals.every((g) => !g.updatedAt && !g.doneDate);
  function mergeDocs(a, b) {
    const deleted = Object.assign({}, b.deleted);
    for (const [k, t] of Object.entries(a.deleted || {})) deleted[k] = Math.max(t, deleted[k] || 0);
    const goals = []; const pos = new Map();
    for (const g of a.goals.concat(b.goals)) {
      if (deleted[g.id]) continue;
      if (!pos.has(g.id)) { pos.set(g.id, goals.length); goals.push(g); }
      else if ((g.updatedAt || 0) > (goals[pos.get(g.id)].updatedAt || 0)) goals[pos.get(g.id)] = g;
    }
    const logs = []; const seen = new Set();
    for (const l of a.logs.concat(b.logs)) {
      if (!l || seen.has(l.id) || deleted[l.id] || deleted[l.goalId]) continue;
      seen.add(l.id); logs.push(l);
    }
    const achievements = Object.assign({}, b.achievements);
    for (const [k, d] of Object.entries(a.achievements || {})) achievements[k] = achievements[k] && achievements[k] < d ? achievements[k] : d;
    return { v: 1, goals: goals.map((g) => newGoal(g)), logs, deleted, achievements };
  }
  function stable(v) { // JSON with sorted keys, so equal content always gives an equal string
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function docKey(d) {
    return stable({
      goals: d.goals.map((g) => newGoal(g)).sort((x, y) => (x.id < y.id ? -1 : 1)),
      logs: d.logs.map((l) => l.id).sort(), deleted: Object.keys(d.deleted || {}).sort(), achievements: d.achievements || {},
    });
  }
  function applyDoc(state, d) {
    state.goals = d.goals.map((g) => newGoal(g)); state.logs = d.logs.slice();
    state.deleted = Object.assign({}, d.deleted); state.achievements = Object.assign({}, d.achievements);
    if (state.timer && !state.goals.some((g) => g.id === state.timer.goalId)) state.timer = null;
    return state;
  }

  // ---------- context (index over logs) ----------
  function context(state, now) {
    now = now || new Date();
    const ix = new Map(); // goalId -> Map(date -> amount)
    for (const l of state.logs) {
      let m = ix.get(l.goalId); if (!m) ix.set(l.goalId, (m = new Map()));
      m.set(l.date, (m.get(l.date) || 0) + l.amount);
    }
    const byId = new Map(state.goals.map((g) => [g.id, g]));
    return { state, now, today: dateKey(now), ix, byId, active: state.goals.filter((g) => !g.archived) };
  }
  const amt = (ctx, g, date) => (ctx.ix.get(g.id) || new Map()).get(date) || 0;
  const sumRange = (ctx, g, from, to) => {
    let s = 0; const m = ctx.ix.get(g.id); if (!m) return 0;
    for (const [d, a] of m) if (d >= from && d <= to) s += a;
    return s;
  };
  const totalOf = (ctx, g) => { let s = 0; const m = ctx.ix.get(g.id); if (m) for (const a of m.values()) s += a; return s; };
  const firstLog = (ctx, g) => { let f = null; const m = ctx.ix.get(g.id); if (m) for (const d of m.keys()) if (!f || d < f) f = d; return f; };

  // ---------- habits ----------
  function habitStatus(ctx, g, date) {
    date = date || ctx.today;
    if (g.period === 'week') {
      const ws = weekStart(date);
      const done = sumRange(ctx, g, ws, addDays(ws, 6));
      return { done, target: g.target, met: done >= g.target, scheduled: true, pct: Math.min(1, done / g.target), daysLeft: daysBetween(date, addDays(ws, 6)) };
    }
    const done = amt(ctx, g, date);
    const scheduled = g.days.includes(dow(date));
    return { done, target: g.target, met: done >= g.target, scheduled, pct: Math.min(1, done / g.target), daysLeft: 0 };
  }

  function streak(ctx, g) {
    if (g.type !== 'habit') return { current: 0, best: 0 };
    const first = firstLog(ctx, g);
    if (!first) return { current: 0, best: 0 };
    let current = 0, best = 0, run = 0;
    if (g.period === 'week') {
      for (let w = weekStart(first); w <= ctx.today; w = addDays(w, 7)) {
        const met = habitStatus(ctx, g, w).met;
        const isThis = w === weekStart(ctx.today);
        if (met) { run++; best = Math.max(best, run); }
        else if (!isThis) run = 0;
      }
      current = run;
    } else {
      for (let d = first; d <= ctx.today; d = addDays(d, 1)) {
        const s = habitStatus(ctx, g, d);
        if (s.met) { run++; best = Math.max(best, run); }
        else if (s.scheduled && d !== ctx.today) run = 0;
      }
      current = run;
    }
    return { current, best };
  }

  // ---------- targets ----------
  function targetStatus(ctx, g) {
    const total = totalOf(ctx, g);
    const start = g.startDate || g.createdAt || ctx.today;
    const deadline = g.deadline || ctx.today;
    const totalDays = Math.max(1, daysBetween(start, deadline) + 1);
    const elapsed = Math.max(0, Math.min(totalDays, daysBetween(start, ctx.today) + 1));
    // "expected" = where you should be by the END of yesterday, so today is never unfairly "behind"
    const expected = g.total * Math.max(0, elapsed - 1) / totalDays;
    const daysLeft = daysBetween(ctx.today, deadline);
    const remaining = Math.max(0, g.total - total);
    const done = total >= g.total;
    let completedDate = null;
    if (done) {
      const m = ctx.ix.get(g.id); let c = 0;
      for (const d of [...m.keys()].sort()) { c += m.get(d); if (c >= g.total) { completedDate = d; break; } }
    }
    const status = done ? 'done' : daysLeft < 0 ? 'overdue' : total + 1e-9 < expected ? 'behind' : 'ontrack';
    return {
      total, target: g.total, pct: Math.min(1, total / g.total), remaining, daysLeft, done, status, completedDate,
      perDay: remaining / Math.max(1, daysLeft + 1), expected, start, deadline,
    };
  }

  // ---------- generic ----------
  function needsWorkToday(ctx, g) {
    if (g.archived) return false;
    if (g.type === 'habit') { const s = habitStatus(ctx, g); return s.scheduled && !s.met; }
    if (g.type === 'target') return !targetStatus(ctx, g).done;
    return !g.doneDate;
  }
  // Is this goal on today's list at all (done or not)?
  function onToday(ctx, g) {
    if (g.archived) return false;
    if (g.type === 'habit') return g.period === 'week' || habitStatus(ctx, g).scheduled || amt(ctx, g, ctx.today) > 0;
    if (g.type === 'target') { const t = targetStatus(ctx, g); return !t.done || t.completedDate === ctx.today; }
    return !g.doneDate || g.doneDate === ctx.today;
  }

  function fmtAmount(n, unit) {
    n = Math.round(n * 10) / 10;
    if (unit === 'min') {
      const m = Math.round(n);
      if (m < 60) return `${m} min`;
      return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
    }
    return `${n} ${n === 1 && unit.length > 3 && /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit}`;
  }

  function remainingText(ctx, g) {
    if (g.type === 'habit') {
      const s = habitStatus(ctx, g);
      return `${fmtAmount(Math.max(0, s.target - s.done), g.unit)} left ${g.period === 'week' ? 'this week' : 'today'}`;
    }
    if (g.type === 'target') {
      const t = targetStatus(ctx, g);
      const when = t.daysLeft < 0 ? `${-t.daysLeft}d overdue` : t.daysLeft === 0 ? 'due today' : t.daysLeft === 1 ? 'due tomorrow' : `due in ${t.daysLeft} days`;
      return `${fmtAmount(t.remaining, g.unit)} to go, ${when}`;
    }
    if (g.due) {
      const d = daysBetween(ctx.today, g.due);
      return d < 0 ? `${-d}d overdue` : d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due in ${d} days`;
    }
    return 'not done yet';
  }

  // ---------- activity / global streak ----------
  function activeDates(ctx) {
    const s = new Set(ctx.state.logs.map((l) => l.date));
    for (const g of ctx.state.goals) if (g.type === 'task' && g.doneDate) s.add(g.doneDate);
    return s;
  }
  function globalStreak(ctx) {
    const s = activeDates(ctx);
    if (!s.size) return { current: 0, best: 0, todayActive: false };
    const first = [...s].sort()[0];
    let run = 0, best = 0;
    for (let d = first; d <= ctx.today; d = addDays(d, 1)) {
      if (s.has(d)) { run++; best = Math.max(best, run); }
      else if (d !== ctx.today) run = 0;
    }
    return { current: run, best, todayActive: s.has(ctx.today) };
  }

  // A day is "perfect" when it has daily habits scheduled and every one of them was met.
  function perfectDay(ctx, date) {
    let n = 0;
    for (const g of ctx.active) {
      if (g.type !== 'habit' || g.period !== 'day') continue;
      if ((g.createdAt || '0') > date) continue;
      const s = habitStatus(ctx, g, date);
      if (!s.scheduled) continue;
      if (!s.met) return false;
      n++;
    }
    return n > 0;
  }

  // ---------- XP ----------
  function computeXP(ctx) {
    const byDate = {}; const byGoal = {}; let total = 0;
    const add = (date, gid, xp) => {
      if (!xp) return; xp = Math.round(xp);
      byDate[date] = (byDate[date] || 0) + xp; byGoal[gid] = (byGoal[gid] || 0) + xp; total += xp;
    };
    for (const g of ctx.state.goals) {
      const m = ctx.ix.get(g.id);
      const rate = g.unit === 'min' ? XP.perMin : (g.xpPerUnit || XP.perUnit);
      if (m) for (const [d, a] of m) add(d, g.id, a * rate);
      if (g.type === 'habit' && m) {
        if (g.period === 'day') {
          for (const [d, a] of m) if (a >= g.target) add(d, g.id, XP.dayBonus);
        } else {
          const weeks = new Map();
          for (const d of [...m.keys()].sort()) {
            const w = weekStart(d); const prev = weeks.get(w) || 0; const next = prev + m.get(d);
            if (prev < g.target && next >= g.target) add(d, g.id, XP.weekBonus);
            weeks.set(w, next);
          }
        }
      }
      if (g.type === 'target') {
        const t = targetStatus(ctx, g);
        if (t.done) add(t.completedDate, g.id, XP.target + (g.deadline && t.completedDate <= g.deadline ? XP.early : 0));
      }
      if (g.type === 'task' && g.doneDate) add(g.doneDate, g.id, XP.task);
      if (g.ladder) for (const h of g.ladder.history || []) add(h.date, g.id, XP.ladder);
    }
    return { total, byDate, byGoal };
  }

  function levelInfo(xp) {
    let level = 1, need = 100, into = xp;
    while (into >= need) { into -= need; level++; need = 100 + (level - 1) * 40; }
    let title = TITLES[0][1], nextTitle = null;
    for (const [l, t] of TITLES) { if (level >= l) title = t; else if (!nextTitle) nextTitle = { level: l, title: t }; }
    return { level, into, need, pct: into / need, title, nextTitle };
  }

  // ---------- language ladder ----------
  function ladderStatus(ctx, g) {
    const lad = g.ladder; if (!lad) return null;
    const L = LADDERS[lad.scale];
    const since = lad.since || g.createdAt || '0000-00-00';
    const minutes = g.unit === 'min' ? sumRange(ctx, g, since, '9999-99-99') : 0;
    const hours = minutes / 60;
    const maxed = lad.current >= L.levels.length - 1;
    return {
      scale: L.label, levels: L.levels, current: lad.current, target: lad.target,
      currentName: lad.current < 0 ? 'Start' : L.levels[lad.current],
      nextName: maxed ? null : L.levels[lad.current + 1],
      hours, hoursNext: lad.hoursNext, pct: maxed ? 1 : Math.min(1, hours / Math.max(1, lad.hoursNext)), maxed,
      reachedTarget: lad.current >= lad.target,
    };
  }
  function ladderLevelUp(g, today) {
    const lad = g.ladder; const L = LADDERS[lad.scale];
    if (lad.current >= L.levels.length - 1) return false;
    lad.current++; lad.since = today;
    lad.history = (lad.history || []).concat([{ level: lad.current, date: today }]);
    lad.hoursNext = L.hours[Math.min(lad.current + 1, L.hours.length - 1)];
    return true;
  }

  // ---------- achievements ----------
  function satisfiedAchievements(ctx) {
    const out = new Set(); const st = ctx.state;
    if (st.logs.length) out.add('first_log');
    const gs = globalStreak(ctx);
    for (const n of [3, 7, 30, 100]) if (gs.best >= n) out.add('streak' + n);
    let minutes = 0; const minByDate = {}; const langByDate = {};
    for (const l of st.logs) {
      const g = ctx.byId.get(l.goalId); if (!g) continue;
      if (g.unit === 'min') { minutes += l.amount; minByDate[l.date] = (minByDate[l.date] || 0) + l.amount; }
      if (g.category === 'language') (langByDate[l.date] = langByDate[l.date] || new Set()).add(g.id);
      if (l.ts) {
        const t = new Date(l.ts);
        if (dateKey(t) === l.date) {
          const h = t.getHours();
          if (h >= 4 && h < 8) out.add('early_bird');
          if (h >= 23 || h < 4) out.add('night_owl');
        }
      }
    }
    for (const n of [10, 50, 100, 500]) if (minutes >= n * 60) out.add('hours' + n);
    if (Object.values(minByDate).some((m) => m >= 180)) out.add('marathon');
    if (Object.values(langByDate).some((s) => s.size >= 3)) out.add('polyglot');
    let run = 0;
    for (let i = 13; i >= 0; i--) {
      const d = addDays(ctx.today, -i);
      if (perfectDay(ctx, d)) { run++; out.add('perfect_day'); if (run >= 7) out.add('perfect_week'); }
      else if (i !== 0) run = 0;
    }
    const tasksDone = st.goals.filter((g) => g.type === 'task' && g.doneDate).length;
    if (tasksDone >= 1) out.add('task1');
    if (tasksDone >= 10) out.add('task10');
    for (const g of st.goals) {
      if (g.type === 'target' && g.deadline) { const t = targetStatus(ctx, g); if (t.done && t.completedDate <= g.deadline) out.add('deadline'); }
      if (g.ladder && (g.ladder.history || []).length) out.add('levelup');
    }
    const lvl = levelInfo(computeXP(ctx).total).level;
    for (const n of [5, 10, 25]) if (lvl >= n) out.add('lvl' + n);
    return out;
  }
  // Mutates state.achievements; returns the newly unlocked definitions.
  function unlockAchievements(state, now) {
    const ctx = context(state, now);
    const fresh = [];
    for (const id of satisfiedAchievements(ctx)) {
      if (!state.achievements[id]) { state.achievements[id] = ctx.today; fresh.push(ACHIEVEMENTS.find((a) => a.id === id)); }
    }
    return fresh;
  }

  // ---------- notifications (decided here, shown by the main process) ----------
  // `sent` is a plain object of keys already shown; returns [{key,title,body}] that are due now.
  function dueNotifications(state, now, sent) {
    const ctx = context(state, now); const s = state.settings; const out = [];
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const T = ctx.today;
    if (s.remindersOn) {
      for (const g of ctx.active) {
        if (!g.reminder) continue;
        const key = `rem:${g.id}:${T}`; if (sent[key]) continue;
        const late = nowMin - hmToMin(g.reminder);
        if (late < 0 || late > 180) continue;
        if (!needsWorkToday(ctx, g)) continue;
        if (state.timer && state.timer.goalId === g.id) continue;
        out.push({ key, title: `${g.icon} ${g.name}`, body: `Time for this one: ${remainingText(ctx, g)}.` });
      }
    }
    if (s.deadlineOn && nowMin >= 10 * 60 && !sent[`deadline:${T}`]) {
      const items = [];
      for (const g of ctx.active) {
        if (g.type === 'target') {
          const t = targetStatus(ctx, g);
          if (!t.done && t.daysLeft <= 3 && (t.status !== 'ontrack' || t.daysLeft <= 1)) items.push(`${g.name}: ${remainingText(ctx, g)}`);
        } else if (g.type === 'task' && !g.doneDate && g.due && daysBetween(T, g.due) <= 1) {
          items.push(`${g.name}: ${remainingText(ctx, g)}`);
        } else if (g.type === 'habit' && g.period === 'week') {
          const h = habitStatus(ctx, g);
          if (!h.met && h.daysLeft <= 1) items.push(`${g.name}: ${remainingText(ctx, g)}`);
        }
      }
      if (items.length) out.push({ key: `deadline:${T}`, title: items.length === 1 ? 'Deadline approaching' : `${items.length} deadlines approaching`, body: items.slice(0, 4).join('\n') });
    }
    if (s.summaryOn && nowMin >= hmToMin(s.summaryTime || '21:00') && !sent[`summary:${T}`]) {
      const todo = ctx.active.filter((g) => {
        if (g.type === 'habit') return g.period === 'day' && needsWorkToday(ctx, g);
        if (g.type === 'target') return targetStatus(ctx, g).status === 'behind' || targetStatus(ctx, g).status === 'overdue';
        return !g.doneDate && g.due && g.due <= T;
      });
      const gs = globalStreak(ctx);
      const xpToday = computeXP(ctx).byDate[T] || 0;
      let title, body;
      if (!todo.length) {
        title = 'Evening summary: all clear ✨';
        body = `Everything for today is done. +${xpToday} XP earned, ${gs.current}-day streak.`;
      } else {
        title = `Evening summary: ${todo.length} still open`;
        body = todo.slice(0, 4).map((g) => `${g.icon} ${g.name}: ${remainingText(ctx, g)}`).join('\n');
        if (todo.length > 4) body += `\n…and ${todo.length - 4} more`;
        if (!gs.todayActive && gs.current > 0) body += `\nYour ${gs.current}-day streak ends at midnight!`;
      }
      out.push({ key: `summary:${T}`, title, body });
    }
    return out;
  }

  function trayTooltip(state, now) {
    const ctx = context(state, now);
    const list = ctx.active.filter((g) => onToday(ctx, g));
    const done = list.filter((g) => !needsWorkToday(ctx, g)).length;
    const lv = levelInfo(computeXP(ctx).total);
    return `Questlog · Level ${lv.level} · ${done}/${list.length} done today`;
  }

  return {
    pad, dateKey, parseKey, addDays, dow, weekStart, daysBetween, hm, hmToMin, uid,
    LADDERS, XP, ACHIEVEMENTS, TITLES,
    defaultState, defaultSettings, normalize, newGoal, newLadder,
    context, amt, sumRange, totalOf, firstLog,
    habitStatus, streak, targetStatus, needsWorkToday, onToday, fmtAmount, remainingText,
    activeDates, globalStreak, perfectDay, computeXP, levelInfo,
    ladderStatus, ladderLevelUp, satisfiedAchievements, unlockAchievements,
    dueNotifications, trayTooltip,
    touch, syncDoc, validDoc, isPristine, mergeDocs, docKey, applyDoc,
  };
});
