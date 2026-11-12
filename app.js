/* Questlog window UI */
(function () {
  'use strict';
  const C = Core, { esc, ring } = Charts;
  const $ = (s, r) => (r || document).querySelector(s);
  const fa = C.fmtAmount;
  const DAY1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
  const CATS = { language: 'Language', study: 'Study', reading: 'Reading', health: 'Health', other: 'Other' };
  const ICONS = ['★', '📖', '✍️', '📄', '💪', '🏃', '🎧', '🧠', '💻', '🎸', 'あ', '中', 'En'];

  let S = null, info = { packaged: false, version: 'preview', dataFile: '', notificationsSupported: true };
  let view = 'today', range = 30, lastDay = null, lastLevel = 1;
  let modal = null; // {kind, ...}
  const expanded = new Set();
  const isWeb = !window.api;
  const api = window.api || (/demo/.test(location.search) ? mockApi() : webApi());
  let sync = null, needRender = false, installEvt = null;

  // ---------- helpers ----------
  function now() { return new Date(); }
  const ctx = () => C.context(S, now());
  const goal = (id) => S.goals.find((g) => g.id === id);
  const color = (g) => `var(--s${(g.slot || 0) % 8})`;
  const glyph = (g, sm) => `<span class="glyph${sm ? ' sm' : ''}" style="--c:${color(g)}">${esc(g.icon || '★')}</span>`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const r1 = (n) => Math.round(n * 10) / 10;
  const amountText = (done, target, unit) => (unit === 'min' ? `<b>${fa(done, 'min')}</b> / ${fa(target, 'min')}` : `<b>${r1(done)}</b> / ${r1(target)} ${esc(unit)}`);

  // Phone / browser build: the same UI, stored in this browser, no OS integration.
  function webApi() {
    const KEY = 'questlog.state.v1';
    const strip = (st) => { const c = JSON.parse(JSON.stringify(st)); delete c.sync; return c; };
    return {
      getState: async () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
      saveState: async (st) => { try { localStorage.setItem(KEY, JSON.stringify(st)); return true; } catch (e) { return false; } },
      notify: async () => true, info: async () => ({ web: true, version: '1.1.0', packaged: false, dataFile: '' }),
      openDataFolder: async () => {}, openUrl: (u) => window.open(u, '_blank', 'noopener'), onStateReplaced: () => {},
      exportData: async () => {
        const name = `questlog-backup-${C.dateKey(now())}.json`; const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(strip(S), null, 2)], { type: 'application/json' })); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000); return name;
      },
      importData: () => new Promise((resolve) => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = async () => {
          try { const raw = JSON.parse(await inp.files[0].text()); resolve(Array.isArray(raw.goals) ? { state: raw } : { error: 'That file is not a Questlog backup.' }); }
          catch (e) { resolve({ error: 'That file is not a Questlog backup.' }); }
        };
        inp.click();
      }),
    };
  }
  function mockApi() {
    let st = demoState();
    return {
      getState: async () => st, saveState: async (s) => { st = s; return true; },
      notify: async (t, b) => console.log('[notify]', t, '|', b), info: async () => info,
      openDataFolder: async () => {}, openUrl: () => {}, exportData: async () => null, importData: async () => null, onStateReplaced: () => {},
    };
  }
  function demoState() { // only used when previewing the UI in a browser with ?demo
    const st = C.defaultState(now()); const today = C.dateKey(now());
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    st.createdAt = C.addDays(today, -80);
    st.goals.forEach((g) => { g.createdAt = st.createdAt; if (g.ladder) g.ladder.since = st.createdAt; });
    const [ja, zh, en, cw, pages, read] = st.goals;
    ja.ladder.current = 0; ja.ladder.hoursNext = 60; zh.ladder.hoursNext = 40; en.ladder.current = 2; en.ladder.target = 4; en.ladder.hoursNext = 45;
    ja.reminder = '19:00';
    pages.startDate = C.addDays(today, -3); pages.deadline = C.addDays(today, 3);
    const gym = C.newGoal({ name: 'Gym', icon: '💪', slot: 6, category: 'health', type: 'habit', unit: 'sessions', target: 3, period: 'week', createdAt: st.createdAt });
    const task = C.newGoal({ name: 'Email supervisor the outline', icon: '📝', slot: 7, type: 'task', due: C.addDays(today, 1), createdAt: today });
    st.goals.push(gym, task);
    const add = (g, d, a, h) => st.logs.push({ id: C.uid(), goalId: g.id, date: d, amount: a, ts: +new Date(C.parseKey(d).getTime() + (h || 18) * 36e5) });
    for (let i = 80; i >= 0; i--) {
      const d = C.addDays(today, -i); const skip = rnd() < 0.12 && i > 6;
      if (skip) continue;
      if (rnd() < 0.9) add(ja, d, i === 0 ? 20 : [15, 30, 30, 45, 60][Math.floor(rnd() * 5)]);
      if (rnd() < 0.7 && i > 0) add(zh, d, [15, 30, 30, 40][Math.floor(rnd() * 4)]);
      if (rnd() < 0.8) add(en, d, [20, 30, 30, 50][Math.floor(rnd() * 4)], i === 0 ? 9 : 18);
      if (rnd() < 0.6 && i > 0) add(cw, d, [30, 30, 45, 60][Math.floor(rnd() * 4)]);
      if (rnd() < 0.65 && i > 0) add(read, d, [20, 30, 30][Math.floor(rnd() * 3)]);
      if (rnd() < 0.4 && i > 0) add(gym, d, 1);
    }
    add(pages, C.addDays(today, -3), 1.5); add(pages, C.addDays(today, -2), 1); add(pages, C.addDays(today, -1), 2);
    C.unlockAchievements(st, now());
    return st;
  }

  // ---------- persistence + celebration ----------
  function save() { api.saveState(S); }
  function commit() {
    const fresh = C.unlockAchievements(S, now());
    save();
    const lv = C.levelInfo(C.computeXP(ctx()).total);
    render();
    if (sync) sync.schedule();
    if (lv.level > lastLevel) {
      toast('🎉', `Level ${lv.level}!`, `Your rank: ${lv.title}`); confetti(160);
      if (S.settings.achievementsOn) api.notify(`Level ${lv.level} reached 🎉`, `Your rank: ${lv.title}. Keep going!`);
    }
    lastLevel = lv.level;
    fresh.forEach((a) => {
      toast(a.icon, 'Achievement unlocked', a.name);
      if (S.settings.achievementsOn) api.notify(`${a.icon} Achievement unlocked: ${a.name}`, a.desc);
    });
    if (fresh.length) confetti(120);
  }

  function addLog(id, amount, date, note) {
    const g = goal(id); if (!g || !(amount > 0)) return;
    const before = ctx(); const open = C.needsWorkToday(before, g); const xp0 = C.computeXP(before).total;
    const entry = { id: C.uid(), goalId: id, date: date || before.today, amount: +amount, ts: Date.now() };
    if (note) entry.note = String(note).slice(0, 200);
    S.logs.push(entry);
    const after = ctx(); const gain = C.computeXP(after).total - xp0;
    if (open && !C.needsWorkToday(after, g)) { toast('✅', `${g.name}: done!`, `+${gain} XP`); confetti(70); }
    else toast('✨', `+${gain} XP`, `${g.name}: ${fa(+amount, g.unit)} logged`);
    commit();
  }

  // ---------- timer ----------
  function startTimer(id) {
    if (S.timer) { toast('⏱️', 'A timer is already running', 'Stop it first'); return; }
    S.timer = { goalId: id, start: Date.now(), notified: false }; save(); render();
  }
  function stopTimer(log) {
    const t = S.timer; if (!t) return;
    const mins = Math.round((Date.now() - t.start) / 60000);
    S.timer = null;
    if (!log) { save(); render(); return; }
    if (mins < 1) { toast('⏱️', 'Less than a minute', 'Nothing was logged'); save(); render(); return; }
    if (mins > 360) { save(); render(); openLog(t.goalId, mins, 'The timer ran for a long time. Adjust the amount if you forgot to stop it.'); return; }
    addLog(t.goalId, mins);
  }
  function renderTimer() {
    const el = $('#timerbar'); const t = S.timer; const g = t && goal(t.goalId);
    if (!g) { el.hidden = true; return; }
    const sec = Math.max(0, Math.floor((Date.now() - t.start) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const time = (h ? h + ':' + C.pad(m) : m) + ':' + C.pad(s);
    if (el.hidden || el.dataset.g !== g.id) {
      el.hidden = false; el.dataset.g = g.id;
      el.innerHTML = `<span class="dot"></span><span>${esc(g.icon)} ${esc(g.name)}</span><span class="time num"></span>
        <button class="btn sm stop" data-act="timerStop">Stop &amp; log</button><button class="btn sm" data-act="timerCancel">Discard</button>`;
    }
    $('.time', el).textContent = time;
    if (!t.notified && g.type === 'habit') {
      const st = C.habitStatus(ctx(), g);
      if (!st.met && st.done + sec / 60 >= st.target) {
        t.notified = true; save();
        api.notify(`${g.icon} ${g.name}: target reached`, `You hit ${fa(st.target, g.unit)} ${g.period === 'week' ? 'for the week' : 'for today'}. Stop the timer whenever you like.`);
      }
    }
  }

  // ---------- views ----------
  function render() {
    const main = $('#main'); const keep = main.dataset.view === view ? main.scrollTop : 0;
    const cx = ctx(); lastDay = cx.today;
    renderSide(cx);
    main.innerHTML = `<div class="page">${({ today: vToday, goals: vGoals, stats: vStats, achievements: vAch, settings: vSettings }[view])(cx)}</div>`;
    main.dataset.view = view; main.scrollTop = keep;
    renderTimer();
  }

  function renderSide(cx) {
    const open = cx.active.filter((g) => C.onToday(cx, g) && C.needsWorkToday(cx, g)).length;
    const items = [['today', '☀️', 'Today', open || ''], ['goals', '🎯', 'Goals', ''], ['stats', '📊', 'Stats', ''], ['achievements', '🏆', 'Achievements', ''], ['settings', '⚙️', 'Settings', '']];
    $('#nav').innerHTML = items.map(([id, ico, label, badge]) =>
      `<button class="nav-item${view === id ? ' on' : ''}" data-act="nav" data-view="${id}"><span class="ico">${ico}</span>${label}${badge ? `<span class="badge num">${badge}</span>` : ''}</button>`).join('');
    const lv = C.levelInfo(C.computeXP(cx).total);
    $('#side-player').innerHTML = `<div class="lv"><span>Level ${lv.level}</span><span class="small muted">${lv.title}</span></div>
      <div class="xpbar"><i style="width:${lv.pct * 100}%"></i></div><div class="small dim num" style="margin-top:6px">${lv.into} / ${lv.need} XP</div>`;
  }

  function seriesFor(cx, days) {
    const list = S.goals.filter((g) => g.unit === 'min').map((g) => ({ g, name: g.name, color: color(g), values: days.map((d) => C.amt(cx, g, d)) }))
      .map((s) => Object.assign(s, { total: s.values.reduce((a, b) => a + b, 0) })).filter((s) => s.total > 0);
    if (list.length <= 8) return list;
    const keep = list.slice().sort((a, b) => b.total - a.total).slice(0, 7);
    const rest = list.filter((s) => !keep.includes(s));
    const other = { name: 'Other', color: 'var(--other)', values: days.map((_, i) => rest.reduce((a, s) => a + s.values[i], 0)) };
    other.total = other.values.reduce((a, b) => a + b, 0);
    return list.filter((s) => keep.includes(s)).concat([other]);
  }
  const legend = (series) => `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  const lastDays = (cx, n) => Array.from({ length: n }, (_, i) => C.addDays(cx.today, i - n + 1));

  const isMobile = () => innerWidth <= 760;
  function contentWidth() { const w = $('#main').clientWidth; return w < 200 ? 1000 : Math.min(1120, w - (isMobile() ? 28 : 60)); }
  const fullCard = () => contentWidth() - 34;
  const halfCard = () => (isMobile() ? fullCard() : (contentWidth() - 14) / 2 - 34);
  function timeChart(cx, n, title) {
    const days = lastDays(cx, n); const series = seriesFor(cx, days);
    const total = series.reduce((a, s) => a + s.total, 0);
    return `<div class="card chart-card"><h3>${title}</h3><div class="cap">${total ? `${fa(total, 'min')} in total, ${fa(total / n, 'min')} a day on average` : 'Minutes logged per day, by goal'}</div>
      ${series.length ? (series.length > 1 ? legend(series) : '') + Charts.stackedBars({ days, series, width: fullCard() }) : '<div class="empty">Nothing logged in this period yet. Start a timer or add time on a goal.</div>'}</div>`;
  }

  // ----- Today -----
  function vToday(cx) {
    const xp = C.computeXP(cx), lv = C.levelInfo(xp.total), gs = C.globalStreak(cx);
    const todays = cx.active.filter((g) => C.onToday(cx, g));
    const doneN = todays.filter((g) => !C.needsWorkToday(cx, g)).length;
    const langs = cx.active.filter((g) => g.category === 'language' && g.type === 'habit');
    const others = todays.filter((g) => !langs.includes(g)).sort((a, b) => C.needsWorkToday(cx, b) - C.needsWorkToday(cx, a));
    const ws = C.weekStart(cx.today);
    const weekMin = cx.active.filter((g) => g.unit === 'min').reduce((a, g) => a + C.sumRange(cx, g, ws, cx.today), 0);
    const d = cx.now; const xpToday = xp.byDate[cx.today] || 0;
    const hello = d.getHours() < 5 ? 'Still up?' : d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';
    const streakFoot = gs.current === 0 ? 'Log anything to start one' : gs.todayActive ? `Best: ${plural(gs.best, 'day')}` : 'Log something today to keep it';
    return `
    <div class="page-head"><div><h1>${hello}</h1><div class="sub">${Charts.DAYS[d.getDay()]}, ${d.getDate()} ${Charts.MONTHS[d.getMonth()]} · ${doneN === todays.length && todays.length ? 'everything is done for today' : `${plural(todays.length - doneN, 'quest')} left today`}</div></div>
      <button class="btn primary" data-act="goalNew">+ New goal</button></div>
    <div class="hero">
      <div class="card level-card">
        <div class="level-badge">${ring(lv.pct, 86, 8, 'var(--xp-a)', '')}<div class="n num">${lv.level}</div></div>
        <div class="meta"><div class="small muted">LEVEL ${lv.level}</div><div class="rank">${lv.title}</div>
          <div class="xpbar"><i style="width:${lv.pct * 100}%"></i></div>
          <div class="small muted num" style="margin-top:6px">${lv.into} / ${lv.need} XP · ${lv.need - lv.into} to level ${lv.level + 1}${lv.nextTitle ? ` · ${lv.nextTitle.title} at level ${lv.nextTitle.level}` : ''}</div></div>
      </div>
      <div class="card tile"><div class="label">Day streak</div><div class="value num">🔥 ${gs.current} <small>${gs.current === 1 ? 'day' : 'days'}</small></div><div class="foot">${streakFoot}</div></div>
      <div class="card tile"><div class="label">Today's quests</div><div class="value num">${doneN}<small> / ${todays.length} done</small></div><div class="pbar" style="margin-top:9px;--c:var(--good)"><i style="width:${todays.length ? (doneN / todays.length) * 100 : 0}%"></i></div></div>
      <div class="card tile"><div class="label">XP today</div><div class="value num">+${xpToday}</div><div class="foot">${fa(weekMin, 'min')} logged this week</div></div>
    </div>
    ${langs.length ? `<section><div class="section-head"><h2>Languages</h2></div><div class="grid g3">${langs.map((g) => langCard(cx, g)).join('')}</div></section>` : ''}
    <section><div class="section-head"><h2>${langs.length ? 'Other quests' : 'Quests'}</h2></div>
      <div class="card quests">${others.length ? others.map((g) => questRow(cx, g)).join('') : '<div class="empty">No other goals for today. Add one with “New goal”.</div>'}</div></section>
    ${timeChart(cx, 14, 'Last 14 days')}`;
  }

  function quickButtons(g) {
    const running = S.timer && S.timer.goalId === g.id;
    if (g.unit === 'min') {
      return `<button class="btn sm${running ? '' : ' primary'}" data-act="${running ? 'timerStop' : 'timerStart'}" data-id="${g.id}">${running ? '■ Stop' : '▶ Start'}</button>
        <button class="btn sm" data-act="log" data-id="${g.id}" data-amt="15">+15</button><button class="btn sm" data-act="log" data-id="${g.id}" data-amt="30">+30</button>
        <button class="btn sm ghost" data-act="logOther" data-id="${g.id}" data-tip="Log a custom amount or another day">Other…</button>`;
    }
    return `<button class="btn sm primary" data-act="log" data-id="${g.id}" data-amt="1">+ ${esc(fa(1, g.unit))}</button>
      <button class="btn sm ghost" data-act="logOther" data-id="${g.id}" data-tip="Log a custom amount or another day">Other…</button>`;
  }

  function weekBars(cx, g) {
    const ws = C.weekStart(cx.today);
    const bars = MON_FIRST.map((_, i) => {
      const d = C.addDays(ws, i); const a = C.amt(cx, g, d); const future = d > cx.today;
      const h = Math.min(1, a / g.target) * 100;
      return `<div class="bar${a >= g.target ? ' met' : ''}${d === cx.today ? ' today' : ''}" data-tip="${esc(Charts.fmtDay(d) + '\n' + (future ? 'Upcoming' : fa(a, g.unit) + ' of ' + fa(g.target, g.unit)))}"><i style="height:${h}%"></i></div>`;
    }).join('');
    return `<div class="week" style="--c:${color(g)}"><div class="bars">${bars}</div><div class="days">${MON_FIRST.map((x) => `<span>${DAY1[x]}</span>`).join('')}</div></div>`;
  }

  function ladderBlock(cx, g) {
    const L = C.ladderStatus(cx, g); if (!L) return '';
    const steps = L.levels.map((_, i) => `<div class="st${i > L.target ? ' beyond' : ''}"><i style="width:${i <= L.current ? 100 : i === L.current + 1 ? L.pct * 100 : 0}%"></i></div>`).join('');
    const labels = L.levels.map((n, i) => `<span class="${i === L.current ? 'cur' : ''}${i === L.target ? ' goal' : ''}">${esc(n.replace('HSK ', ''))}</span>`).join('');
    const head = L.maxed ? `<b>${L.scale}</b> · ${esc(L.currentName)} reached, top level` : `<b>${L.scale}</b> · ${esc(L.currentName)} → ${esc(L.nextName)}`;
    const hrs = L.maxed ? '' : ` · <span class="muted num" data-tip="Study hours logged since ${esc(L.currentName === 'Start' ? 'you started' : 'reaching ' + L.currentName)}, against your estimate for ${esc(L.nextName)}. Edit the goal to change the estimate.">${r1(L.hours)} / ${L.hoursNext} h</span>`;
    const up = L.maxed || g.archived ? '' : `<button class="btn sm ${L.pct >= 1 ? 'gold' : 'ghost'}" style="margin:-4px 0" data-act="ladderUp" data-id="${g.id}" data-tip="Mark ${esc(L.nextName)} as reached (+${C.XP.ladder} XP)">${esc(L.nextName.replace('HSK ', 'HSK'))} ↑</button>`;
    return `<div class="ladder" style="--c:${color(g)}"><div class="top"><span>${head}${hrs}</span>${up}</div>
      <div class="steps">${steps}</div><div class="steplabels">${labels}</div></div>`;
  }

  function langCard(cx, g) {
    const st = C.habitStatus(cx, g), sk = C.streak(cx, g);
    const inner = st.met ? `<b>✓</b><span>${fa(st.done, g.unit)}</span>` : `<b class="num">${Math.round(st.done)}</b><span>of ${fa(st.target, g.unit)}</span>`;
    const sub = g.period === 'week' ? `this week · ${sk.current ? `🔥 ${plural(sk.current, 'week')}` : 'no streak yet'}` : `${st.scheduled ? 'today' : 'rest day'} · ${sk.current ? `🔥 ${plural(sk.current, 'day')}` : 'no streak yet'}`;
    return `<div class="card lang">
      <div class="lang-head">${glyph(g)}<div class="t"><h3>${esc(g.name)}</h3><div class="small muted">${sub}</div></div>
        <button class="btn sm ghost" data-act="goalEdit" data-id="${g.id}" data-tip="Edit goal">⋯</button></div>
      <div class="lang-mid">${ring(st.pct, 78, 8, st.met ? 'var(--good)' : color(g), inner)}${g.period === 'day' ? weekBars(cx, g) : `<div class="week"><div class="pwrap"><div class="lbl"><span>This week</span><span>${amountText(st.done, st.target, g.unit)}</span></div><div class="pbar" style="--c:${color(g)}"><i style="width:${st.pct * 100}%"></i></div></div></div>`}</div>
      ${ladderBlock(cx, g)}
      <div class="actions">${quickButtons(g)}</div>
    </div>`;
  }

  function statusChip(status) {
    const m = { done: ['good', '✓ Done'], ontrack: ['good', 'On track'], behind: ['serious', '▲ Behind pace'], overdue: ['critical', '! Overdue'] }[status];
    return `<span class="chip ${m[0]}"><span class="d"></span>${m[1]}</span>`;
  }

  function questRow(cx, g) {
    let meta = '', bar = '', actions = '', done = false;
    if (g.type === 'habit') {
      const st = C.habitStatus(cx, g), sk = C.streak(cx, g); done = st.met;
      meta = `${done ? statusChip('done') : ''}<span>${g.period === 'week' ? `Weekly${!done && st.daysLeft <= 1 ? ' · week ends ' + (st.daysLeft ? 'tomorrow' : 'today') : ''}` : 'Daily'}</span>${sk.current ? `<span>🔥 ${sk.current}</span>` : ''}`;
      bar = `<div class="pwrap"><div class="lbl"><span>${g.period === 'week' ? 'This week' : 'Today'}</span><span class="num">${amountText(st.done, st.target, g.unit)}</span></div><div class="pbar" style="--c:${done ? 'var(--good)' : color(g)}"><i style="width:${st.pct * 100}%"></i></div></div>`;
      actions = quickButtons(g);
    } else if (g.type === 'target') {
      const t = C.targetStatus(cx, g); done = t.done;
      const when = t.daysLeft < 0 ? `${plural(-t.daysLeft, 'day')} overdue` : t.daysLeft === 0 ? 'due today' : t.daysLeft === 1 ? 'due tomorrow' : `due in ${t.daysLeft} days`;
      meta = `${statusChip(t.status)}${done ? '' : `<span>${when}</span><span>${fa(t.perDay, g.unit)} a day needed</span>`}`;
      bar = `<div class="pwrap"><div class="lbl"><span>Total</span><span class="num">${amountText(t.total, t.target, g.unit)}</span></div><div class="pbar" style="--c:${done ? 'var(--good)' : color(g)}"><i style="width:${t.pct * 100}%"></i>${!done && t.expected > 0 ? `<span class="mark" style="left:calc(${Math.min(1, t.expected / t.target) * 100}% - 1px)" data-tip="Even pace: ${esc(fa(t.expected, g.unit))} by now"></span>` : ''}</div></div>`;
      actions = quickButtons(g);
    } else {
      done = !!g.doneDate;
      meta = done ? statusChip('done') : `<span>One-off task</span>${g.due ? `<span>${C.remainingText(cx, g)}</span>` : ''}`;
      bar = '<span></span>';
      actions = `<button class="btn sm${done ? '' : ' primary'}" data-act="taskToggle" data-id="${g.id}">${done ? 'Undo' : '✓ Mark done'}</button>`;
    }
    return `<div class="quest${done ? ' done' : ''}">${glyph(g)}<div><div class="name">${esc(g.name)}</div><div class="meta">${meta}</div></div>${bar}<div class="actions">${actions}<button class="btn sm ghost" data-act="goalEdit" data-id="${g.id}" data-tip="Edit goal">⋯</button></div></div>`;
  }

  // ----- Goals -----
  function goalSummary(cx, g) {
    if (g.type === 'habit') return `${g.unit === 'min' ? fa(g.target, 'min') : `${r1(g.target)} ${esc(g.unit)}`} ${g.period === 'week' ? 'a week' : g.days.length === 7 ? 'every day' : 'on ' + MON_FIRST.filter((d) => g.days.includes(d)).map((d) => Charts.DAYS[d]).join(', ')}`;
    if (g.type === 'target') return `${r1(g.total)} ${esc(g.unit === 'min' ? 'min' : g.unit)} by ${Charts.shortDay(g.deadline)}`;
    return g.due ? `One-off task, due ${Charts.shortDay(g.due)}` : 'One-off task';
  }
  function goalCard(cx, g, xp) {
    const total = C.totalOf(cx, g); let stats = '', bar = '';
    if (g.type === 'habit') {
      const st = C.habitStatus(cx, g), sk = C.streak(cx, g);
      stats = `<span>Streak <b>${sk.current}</b></span><span>Best <b>${sk.best}</b></span><span>Total <b>${fa(total, g.unit)}</b></span>`;
      bar = `<div class="pbar" style="--c:${color(g)}"><i style="width:${st.pct * 100}%"></i></div>`;
    } else if (g.type === 'target') {
      const t = C.targetStatus(cx, g);
      stats = `${statusChip(t.status)}<span>Done <b>${fa(t.total, g.unit)}</b> of ${fa(t.target, g.unit)}</span>`;
      bar = `<div class="pbar" style="--c:${color(g)}"><i style="width:${t.pct * 100}%"></i></div>`;
    } else stats = g.doneDate ? `${statusChip('done')}<span>Completed ${Charts.shortDay(g.doneDate)}</span>` : `<span>${C.remainingText(cx, g)}</span>`;
    const logs = S.logs.filter((l) => l.goalId === g.id).sort((a, b) => (b.date + b.ts > a.date + a.ts ? 1 : -1));
    const isOpen = expanded.has(g.id);
    return `<div class="card goal-card">
      <div class="head">${glyph(g)}<div class="t"><h3>${esc(g.name)}</h3><div class="small muted">${goalSummary(cx, g)}${g.reminder ? ` · 🔔 ${g.reminder}` : ''}</div></div></div>
      ${bar}<div class="stats">${stats}<span>XP <b class="num">${xp.byGoal[g.id] || 0}</b></span></div>
      ${g.ladder ? ladderBlock(cx, g) : ''}
      <div class="actions">
        ${g.archived ? `<button class="btn sm" data-act="goalArchive" data-id="${g.id}">Restore</button>` : `<button class="btn sm" data-act="goalEdit" data-id="${g.id}">Edit</button>${g.type !== 'task' ? `<button class="btn sm" data-act="logOther" data-id="${g.id}">Log…</button>` : `<button class="btn sm" data-act="taskToggle" data-id="${g.id}">${g.doneDate ? 'Undo' : '✓ Mark done'}</button>`}
        <button class="btn sm ghost" data-act="goalArchive" data-id="${g.id}" data-tip="Hide from Today but keep history and XP">Archive</button>`}
        <button class="btn sm ghost danger" data-act="goalDelete" data-id="${g.id}">Delete</button><span class="sp"></span>
        ${logs.length ? `<button class="btn sm ghost" data-act="toggleEntries" data-id="${g.id}">${isOpen ? 'Hide' : 'Show'} entries (${logs.length})</button>` : ''}
      </div>
      ${isOpen && logs.length ? `<div class="entries">${logs.slice(0, 12).map((l) => `<div class="e"><span class="num">${Charts.fmtDay(l.date)}</span><b class="num">${fa(l.amount, g.unit)}</b><span>${esc(l.note || '')}</span><button class="x" data-act="logDelete" data-id="${l.id}" data-tip="Delete this entry">✕</button></div>`).join('')}${logs.length > 12 ? `<div class="e dim">…and ${logs.length - 12} older entries</div>` : ''}</div>` : ''}
    </div>`;
  }
  function vGoals(cx) {
    const xp = C.computeXP(cx);
    const sec = (title, list) => (list.length ? `<section><div class="section-head"><h2>${title}</h2></div><div class="grid g2">${list.map((g) => goalCard(cx, g, xp)).join('')}</div></section>` : '');
    const A = cx.active;
    return `<div class="page-head"><div><h1>Goals</h1><div class="sub">${plural(A.length, 'active goal')}. Habits repeat, targets have a deadline, tasks are done once.</div></div><button class="btn primary" data-act="goalNew">+ New goal</button></div>
      ${A.length ? '' : '<div class="card empty">No goals yet. Create your first one.</div>'}
      ${sec('Habits', A.filter((g) => g.type === 'habit'))}${sec('Targets with a deadline', A.filter((g) => g.type === 'target'))}${sec('One-off tasks', A.filter((g) => g.type === 'task'))}
      ${sec('Archived', S.goals.filter((g) => g.archived))}`;
  }

  // ----- Stats -----
  function vStats(cx) {
    const xp = C.computeXP(cx); const days = lastDays(cx, range); const from = days[0];
    const series = seriesFor(cx, days); const mins = series.reduce((a, s) => a + s.total, 0);
    const active = C.activeDates(cx); const activeN = days.filter((d) => active.has(d)).length;
    const xpRange = days.reduce((a, d) => a + (xp.byDate[d] || 0), 0); const gs = C.globalStreak(cx);
    const targets = cx.active.filter((g) => g.type === 'target');
    const logs = S.logs.filter((l) => l.date >= from).sort((a, b) => (b.date + (b.ts || 0) > a.date + (a.ts || 0) ? 1 : -1));
    const burn = (g) => {
      const t = C.targetStatus(cx, g); const cum = []; let c = C.sumRange(cx, g, '0000-00-00', C.addDays(t.start, -1));
      for (let d = t.start; d <= cx.today; d = C.addDays(d, 1)) { c += C.amt(cx, g, d); cum.push({ d, v: c }); }
      return `<div class="card chart-card"><h3>${esc(g.icon)} ${esc(g.name)}</h3><div class="cap">${fa(t.total, g.unit)} of ${fa(t.target, g.unit)} · ${t.done ? 'completed' : C.remainingText(cx, g)}</div>
        <div class="legend"><span><i class="line" style="background:${color(g)}"></i>Done so far</span><span><i class="dash"></i>Even pace</span></div>
        ${Charts.burnup({ start: t.start, deadline: t.deadline, today: cx.today, cumulative: cum, target: t.target, unit: g.unit, color: color(g), width: halfCard() })}</div>`;
    };
    const weeks = Math.max(8, Math.min(26, Math.floor((halfCard() - 36) / 16)));
    return `<div class="page-head"><div><h1>Stats</h1><div class="sub">How the last ${range} days went.</div></div>
        <div class="seg">${[7, 30, 90].map((n) => `<button class="${range === n ? 'on' : ''}" data-act="range" data-n="${n}">${n} days</button>`).join('')}</div></div>
      <div class="grid g4">
        <div class="card tile"><div class="label">Time logged</div><div class="value num">${fa(mins, 'min')}</div><div class="foot">${fa(mins / range, 'min')} a day on average</div></div>
        <div class="card tile"><div class="label">Active days</div><div class="value num">${activeN}<small> / ${range}</small></div><div class="foot">${Math.round((activeN / range) * 100)}% of days</div></div>
        <div class="card tile"><div class="label">XP earned</div><div class="value num">${xpRange.toLocaleString('en')}</div><div class="foot">${xp.total.toLocaleString('en')} XP all time</div></div>
        <div class="card tile"><div class="label">Best day streak</div><div class="value num">${gs.best}<small> ${gs.best === 1 ? 'day' : 'days'}</small></div><div class="foot">Current: ${gs.current}</div></div>
      </div>
      ${timeChart(cx, range, 'Time per day')}
      <div class="grid g2">
        <div class="card chart-card"><h3>Activity</h3><div class="cap">XP earned each day over the last ${weeks} weeks</div>${Charts.heatmap({ byDate: xp.byDate, weeks, today: cx.today })}</div>
        <div class="card chart-card"><h3>Time by goal</h3><div class="cap">Total over the last ${range} days</div>${series.length ? Charts.hbars(series.slice().sort((a, b) => b.total - a.total).map((s) => ({ name: s.name, value: s.total, color: s.color })), (v) => fa(v, 'min')) : '<div class="empty">No time logged yet.</div>'}</div>
      </div>
      ${targets.length ? `<section><div class="section-head"><h2>Targets</h2></div><div class="grid g2">${targets.map(burn).join('')}</div></section>` : ''}
      <section><div class="section-head"><h2>Log</h2></div><div class="card">${logs.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Goal</th><th class="r">Amount</th><th>Note</th><th></th></tr></thead><tbody>
        ${logs.slice(0, 40).map((l) => { const g = goal(l.goalId); return g ? `<tr><td class="num">${Charts.fmtDay(l.date)}</td><td>${esc(g.icon)} ${esc(g.name)}</td><td class="r">${fa(l.amount, g.unit)}</td><td class="muted">${esc(l.note || '')}</td><td class="r"><button class="btn sm ghost" data-act="logDelete" data-id="${l.id}" data-tip="Delete this entry">✕</button></td></tr>` : ''; }).join('')}
        </tbody></table>${logs.length > 40 ? `<div class="small dim" style="padding:8px">Showing the latest 40 of ${logs.length} entries.</div>` : ''}` : '<div class="empty">No entries in this period.</div>'}</div></section>`;
  }

  // ----- Achievements -----
  function vAch(cx) {
    const got = S.achievements; const n = C.ACHIEVEMENTS.filter((a) => got[a.id]).length;
    const list = C.ACHIEVEMENTS.slice().sort((a, b) => !!got[b.id] - !!got[a.id]);
    return `<div class="page-head"><div><h1>Achievements</h1><div class="sub">${n} of ${C.ACHIEVEMENTS.length} unlocked</div></div></div>
      <div class="pbar" style="--c:var(--xp-a)"><i style="width:${(n / C.ACHIEVEMENTS.length) * 100}%"></i></div>
      <div class="grid g3">${list.map((a) => `<div class="card ach${got[a.id] ? ' on' : ''}"><div class="medal">${a.icon}</div><div><h3>${a.name}</h3><div class="d">${a.desc}</div>${got[a.id] ? `<div class="small dim">Unlocked ${Charts.shortDay(got[a.id])}</div>` : ''}</div></div>`).join('')}</div>
      <div class="card"><h3>How XP works</h3><div class="muted" style="margin-top:6px;line-height:1.7">
        ${C.XP.perMin} XP per minute of logged time · ${C.XP.perUnit} XP per unit on counted goals (editable per goal)<br>
        +${C.XP.dayBonus} XP for finishing a daily habit · +${C.XP.weekBonus} XP for a weekly one · +${C.XP.task} XP per one-off task<br>
        +${C.XP.target} XP for hitting a target, +${C.XP.early} more if it is on time · +${C.XP.ladder} XP for each new language level</div></div>`;
  }

  // ----- Settings -----
  function ago(ts) {
    if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  }
  function syncStatusText() {
    const st = sync ? sync.status() : { state: 'off' }; const c = S.sync || {};
    if (st.state === 'syncing') return 'Syncing…';
    if (st.state === 'error') return '⚠️ ' + st.message;
    if (st.state === 'offline') return `Offline. Last synced ${ago(c.lastSync)}; will retry automatically.`;
    return `Connected. Last synced ${ago(c.lastSync)}.`;
  }
  function qrSvg(text) {
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag(4, 12); } catch (e) { return ''; }
  }
  function syncSection(row) {
    const c = S.sync || {}; const on = !!c.token;
    const tokenUrl = 'https://github.com/settings/tokens/new?scopes=gist&description=Questlog%20sync';
    if (!on) {
      return `<section><div class="section-head"><h2>Sync</h2></div><div class="card" style="padding:4px 16px">
        ${row(isWeb ? 'Sync with your computer' : 'Sync with your phone', `Goals and entries are kept in a private file (a secret Gist) in your own GitHub account, and every device merges its changes into it.${isWeb ? ' The easiest way to connect is to scan the QR code shown in Questlog on your computer (Settings → Sync).' : ''}`, '')}
        ${row('1. Create a token', 'On GitHub, create a classic personal access token with only the “gist” permission ticked.', `<button class="btn" data-act="openUrl" data-url="${tokenUrl}">Open GitHub…</button>`)}
        ${row('2. Paste it here', 'The token is stored only on this device.', `<div class="sync-connect"><input id="sync-token" class="inp" type="password" placeholder="ghp_…" autocomplete="off" spellcheck="false"><button class="btn primary" data-act="syncConnect">Connect</button></div>`)}
      </div></section>`;
    }
    const url = (c.pwaUrl || '').trim(); const okUrl = /^https:\/\/.+/.test(url);
    return `<section><div class="section-head"><h2>Sync</h2></div><div class="card" style="padding:4px 16px">
      ${row('GitHub sync', `<span id="sync-status">${esc(syncStatusText())}</span>`, '<div style="display:flex;gap:8px"><button class="btn" data-act="syncNow">Sync now</button><button class="btn ghost" data-act="syncDisconnect">Turn off</button></div>')}
      ${isWeb ? '' : row('Phone app address', 'The GitHub Pages address where you published the phone version.', `<input class="inp" style="width:300px;max-width:100%" data-sync="pwaUrl" value="${esc(url)}" placeholder="https://yourname.github.io/questlog/" spellcheck="false">`)}
      ${isWeb || !okUrl ? '' : row('Connect your phone', 'Point the phone camera at this code. Questlog opens on the phone already connected; then choose “Add to Home screen” in the browser menu. The code contains your token, so do not share a photo of it.', `<div class="qr">${qrSvg(Sync.makeLink(url, c))}</div>`)}
    </div></section>`;
  }
  function vSettings() {
    const s = S.settings;
    const sw = (key, dis) => `<label class="switch"><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''} ${dis ? 'disabled' : ''}><i></i></label>`;
    const row = (t, d, ctl) => `<div class="set-row"><div><div><b>${t}</b></div><div class="d">${d}</div></div>${ctl}</div>`;
    const desktop = `<section><div class="section-head"><h2>Startup</h2></div><div class="card" style="padding:4px 16px">
        ${row('Start with Windows', info.packaged ? 'Launch Questlog automatically when you sign in.' : 'Available in the installed Windows app.', sw('autostart', !info.packaged))}
        ${row('Start minimised to the tray', 'On automatic start, stay in the tray without opening the window.', sw('startHidden'))}
        ${row('Theme', 'Follow Windows or force light or dark.', `<select class="inp" style="width:140px" data-set="theme">${['system', 'light', 'dark'].map((t) => `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>`)}
      </div></section>
      <section><div class="section-head"><h2>Notifications</h2></div><div class="card" style="padding:4px 16px">
        ${row('Goal reminders', 'Notify at the reminder time set on each goal, if it is not done yet.', sw('remindersOn'))}
        ${row('Evening summary', 'One notification listing what is still open today and whether your streak is at risk.', `<div style="display:flex;gap:10px;align-items:center"><input type="time" class="inp" style="width:110px" data-set="summaryTime" value="${s.summaryTime}">${sw('summaryOn')}</div>`)}
        ${row('Deadline warnings', 'Once a day, warn about targets that are behind pace and tasks that are due soon.', sw('deadlineOn'))}
        ${row('Achievements and level-ups', 'Celebrate new levels and unlocked achievements.', sw('achievementsOn'))}
        ${row('Test', 'Send a sample notification to check that Windows shows them.', '<button class="btn" data-act="testNotify">Send test notification</button>')}
      </div></section>`;
    const phone = `${installEvt ? `<section><div class="card" style="padding:4px 16px">${row('Install on this phone', 'Adds Questlog to your home screen and lets it work offline.', '<button class="btn primary" data-act="install">Install</button>')}</div></section>` : ''}
      <div class="card muted">Reminders and the evening summary are sent by Questlog on your computer. This phone version is for logging progress and checking your stats; it works offline and syncs when it is back online.</div>`;
    return `<div class="page-head"><div><h1>Settings</h1></div></div>
      ${syncSection(row)}
      ${isWeb ? phone : desktop}
      <section><div class="section-head"><h2>Data</h2></div><div class="card" style="padding:4px 16px">
        ${row('Backup', 'Export a copy of your data or restore one.', '<div style="display:flex;gap:8px"><button class="btn" data-act="export">Export…</button><button class="btn" data-act="import">Import…</button></div>')}
        ${isWeb ? '' : row('Data file', `<span style="user-select:text">${esc(info.dataFile || 'In memory (preview)')}</span>`, '<button class="btn" data-act="openFolder">Show in folder</button>')}
      </div></section>
      <div class="small dim">Questlog ${esc(info.version)}</div>`;
  }

  // ---------- modals ----------
  function closeModal() { modal = null; $('#modal').hidden = true; $('#modal').innerHTML = ''; if (needRender) { needRender = false; render(); } }
  function showModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; const f = m.querySelector('[autofocus]'); if (f) { f.focus(); if (f.select) f.select(); } }

  function confirmDlg(title, text, okLabel, onOk, danger) {
    modal = { kind: 'confirm', onOk };
    showModal(`<div class="dialog narrow" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3></header><div class="body"><div class="muted">${esc(text)}</div></div>
      <footer><button class="btn" data-act="modalClose">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="modalOk" autofocus>${esc(okLabel)}</button></footer></div>`);
  }

  function openLog(id, amount, hint) {
    const g = goal(id); if (!g) return;
    modal = { kind: 'log', id };
    const today = C.dateKey(now());
    showModal(`<div class="dialog narrow" role="dialog" aria-modal="true"><header><h3>${esc(g.icon)} Log ${esc(g.name)}</h3></header><div class="body">
      ${hint ? `<div class="small muted">${esc(hint)}</div>` : ''}
      <div class="row"><div class="field"><label for="l-amt">Amount (${esc(g.unit === 'min' ? 'minutes' : g.unit)})</label><input id="l-amt" class="inp" type="number" min="0" step="any" value="${amount || ''}" autofocus></div>
      <div class="field"><label for="l-date">Day</label><input id="l-date" class="inp" type="date" value="${today}" max="${today}"></div></div>
      <div class="field"><label for="l-note">Note (optional)</label><input id="l-note" class="inp" maxlength="200" placeholder="What did you work on?"></div><div class="err" id="l-err"></div></div>
      <footer><button class="btn" data-act="modalClose">Cancel</button><button class="btn primary" data-act="modalOk">Log it</button></footer></div>`);
  }

  function freeSlot() { const used = new Set(S.goals.filter((g) => !g.archived).map((g) => g.slot % 8)); for (let i = 0; i < 8; i++) if (!used.has(i)) return i; return S.goals.length % 8; }
  function openGoal(id) {
    const g = id ? goal(id) : null; const today = C.dateKey(now());
    const d = g ? JSON.parse(JSON.stringify(g)) : C.newGoal({ id: null, slot: freeSlot(), startDate: today, deadline: C.addDays(C.weekStart(today), 6), createdAt: today });
    d.unitKind = d.unit === 'min' ? 'min' : 'count'; d.unitName = d.unit === 'min' ? '' : d.unit;
    d.startDate = d.startDate || today; d.deadline = d.deadline || C.addDays(today, 7);
    d.ladderScale = d.ladder ? d.ladder.scale : ''; d.ladderCurrent = d.ladder ? d.ladder.current : -1;
    d.ladderTarget = d.ladder ? d.ladder.target : 0; d.ladderHours = d.ladder ? d.ladder.hoursNext : 0;
    modal = { kind: 'goal', draft: d, isNew: !g, err: '' };
    renderGoalForm();
  }
  const TEMPLATES = [
    ['30 min every day', { type: 'habit', unitKind: 'min', target: 30, period: 'day', days: [0, 1, 2, 3, 4, 5, 6] }],
    ['3 times a week', { type: 'habit', unitKind: 'count', unitName: 'sessions', target: 3, period: 'week' }],
    ['10 pages by Sunday', { type: 'target', unitKind: 'count', unitName: 'pages', total: 10, xpPerUnit: 20 }],
    ['A language', { type: 'habit', unitKind: 'min', target: 30, period: 'day', category: 'language', ladderScale: 'CEFR', ladderCurrent: -1, ladderTarget: 3, ladderHours: 100 }],
    ['One-off task', { type: 'task' }],
  ];
  function renderGoalForm() {
    const d = modal.draft; const v = (x) => esc(x == null ? '' : x);
    const typeBtn = (t, title, sub) => `<button type="button" class="${d.type === t ? 'on' : ''}" data-act="draft" data-f="type" data-v="${t}"><b>${title}</b><span>${sub}</span></button>`;
    const unitRow = `<div class="field" style="flex:0 0 auto"><span class="l">Measured in</span><div class="seg"><button type="button" class="${d.unitKind === 'min' ? 'on' : ''}" data-act="draft" data-f="unitKind" data-v="min">Time</button><button type="button" class="${d.unitKind === 'count' ? 'on' : ''}" data-act="draft" data-f="unitKind" data-v="count">Count</button></div></div>
      ${d.unitKind === 'count' ? `<div class="field"><label>Unit</label><input class="inp" data-f="unitName" value="${v(d.unitName)}" placeholder="pages, words, lessons…" maxlength="20"></div>` : ''}`;
    let body = '';
    if (d.type === 'habit') {
      body = `<div class="row">${unitRow}<div class="field"><label>${d.unitKind === 'min' ? 'Minutes' : 'How many'}</label><input class="inp" type="number" min="0" step="any" data-f="target" data-n="1" value="${v(d.target)}"></div>
        <div class="field" style="flex:0 0 auto"><span class="l">Every</span><div class="seg"><button type="button" class="${d.period === 'day' ? 'on' : ''}" data-act="draft" data-f="period" data-v="day">Day</button><button type="button" class="${d.period === 'week' ? 'on' : ''}" data-act="draft" data-f="period" data-v="week">Week</button></div></div></div>
        ${d.period === 'day' ? `<div class="field"><span class="l">On these days</span><div class="daychips">${MON_FIRST.map((x) => `<button type="button" class="${d.days.includes(x) ? 'on' : ''}" data-act="draftDay" data-v="${x}">${Charts.DAYS[x]}</button>`).join('')}</div></div>` : ''}`;
    } else if (d.type === 'target') {
      body = `<div class="row">${unitRow}<div class="field"><label>Total to reach${d.unitKind === 'min' ? ' (minutes)' : ''}</label><input class="inp" type="number" min="0" step="any" data-f="total" data-n="1" value="${v(d.total)}"></div></div>
        <div class="row"><div class="field"><label>Start</label><input class="inp" type="date" data-f="startDate" value="${v(d.startDate)}"></div><div class="field"><label>Deadline</label><input class="inp" type="date" data-f="deadline" value="${v(d.deadline)}"></div>
        ${d.unitKind === 'count' ? `<div class="field"><label>XP per unit</label><input class="inp" type="number" min="0" data-f="xpPerUnit" data-n="1" value="${v(d.xpPerUnit)}"></div>` : ''}</div>`;
    } else {
      body = `<div class="row"><div class="field"><label>Due date (optional)</label><input class="inp" type="date" data-f="due" value="${v(d.due)}"></div></div>`;
    }
    let ladder = '';
    if (d.type === 'habit' && d.unitKind === 'min' && d.category === 'language') {
      const L = d.ladderScale ? C.LADDERS[d.ladderScale] : null;
      ladder = `<div class="row"><div class="field"><label>Exam level track</label><select class="inp" data-f="ladderScale" data-re="1"><option value="">None</option>${Object.keys(C.LADDERS).map((k) => `<option value="${k}" ${d.ladderScale === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        ${L ? `<div class="field"><label>Current level</label><select class="inp" data-f="ladderCurrent" data-n="1" data-re="1"><option value="-1">Not yet ${L.levels[0]}</option>${L.levels.map((n, i) => `<option value="${i}" ${+d.ladderCurrent === i ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Goal level</label><select class="inp" data-f="ladderTarget" data-n="1">${L.levels.map((n, i) => `<option value="${i}" ${+d.ladderTarget === i ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label data-tip="A rough estimate of the study hours between levels. The bar on the card fills as you log time. Change it to match your own pace.">Hours to next level ⓘ</label><input class="inp" type="number" min="1" data-f="ladderHours" data-n="1" value="${v(d.ladderHours)}"></div>` : ''}</div>`;
    }
    showModal(`<div class="dialog" role="dialog" aria-modal="true"><header><h3>${modal.isNew ? 'New goal' : 'Edit goal'}</h3><button class="btn sm ghost" data-act="modalClose" aria-label="Close">✕</button></header><div class="body">
      ${modal.isNew ? `<div class="field"><span class="l">Start from an example</span><div class="tmpl">${TEMPLATES.map((t, i) => `<button type="button" class="btn sm" data-act="tmpl" data-i="${i}">${t[0]}</button>`).join('')}</div></div>` : ''}
      <div class="typepick">${typeBtn('habit', 'Habit', 'Repeats daily or weekly')}${typeBtn('target', 'Target', 'A total by a deadline')}${typeBtn('task', 'Task', 'Done once')}</div>
      <div class="row"><div class="field" style="flex:3"><label>Name</label><input class="inp" data-f="name" value="${v(d.name)}" maxlength="60" placeholder="e.g. Work on coursework" ${d.name ? '' : 'autofocus'}></div>
        <div class="field" style="flex:0 0 74px"><label data-tip="One or two characters, or an emoji">Icon</label><input class="inp" data-f="icon" value="${v(d.icon)}" maxlength="4" list="iconlist" style="text-align:center"><datalist id="iconlist">${ICONS.map((i) => `<option value="${i}">`).join('')}</datalist></div>
        <div class="field" style="flex:2"><label>Category</label><select class="inp" data-f="category" data-re="1">${Object.entries(CATS).map(([k, n]) => `<option value="${k}" ${d.category === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      ${body}${ladder}
      <div class="row"><div class="field"><span class="l">Colour</span><div class="swatches">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<button type="button" class="sw${d.slot % 8 === i ? ' on' : ''}" style="--c:var(--s${i})" data-act="draft" data-f="slot" data-v="${i}" data-n="1" aria-label="Colour ${i + 1}"></button>`).join('')}</div></div>
        <div class="field" style="flex:0 0 150px"><label data-tip="Windows notification at this time on days when the goal is still open. Leave empty for none.">Reminder ⓘ</label><input class="inp" type="time" data-f="reminder" value="${v(d.reminder)}"></div></div>
      <div class="err">${esc(modal.err || '')}</div></div>
      <footer><button class="btn" data-act="modalClose">Cancel</button><button class="btn primary" data-act="modalOk">${modal.isNew ? 'Create goal' : 'Save'}</button></footer></div>`);
  }
  function saveGoal() {
    const d = modal.draft; const today = C.dateKey(now());
    const fail = (m) => { modal.err = m; renderGoalForm(); };
    d.name = (d.name || '').trim(); if (!d.name) return fail('Give the goal a name.');
    d.icon = (d.icon || '').trim() || '★';
    d.unit = d.type === 'task' ? 'min' : d.unitKind === 'min' ? 'min' : (d.unitName || '').trim() || 'units';
    if (d.type === 'habit') { if (!(d.target > 0)) return fail('Enter an amount greater than zero.'); if (d.period === 'day' && !d.days.length) return fail('Pick at least one day.'); }
    if (d.type === 'target') {
      if (!(d.total > 0)) return fail('Enter a total greater than zero.');
      if (!d.startDate || !d.deadline) return fail('Set a start date and a deadline.');
      if (d.deadline < d.startDate) return fail('The deadline is before the start date.');
    }
    if (d.type !== 'task') { d.due = null; d.doneDate = null; }
    const old = modal.isNew ? null : goal(d.id);
    if (d.type === 'habit' && d.unit === 'min' && d.category === 'language' && d.ladderScale) {
      const prev = old && old.ladder && old.ladder.scale === d.ladderScale ? old.ladder : null;
      const lad = prev ? JSON.parse(JSON.stringify(prev)) : C.newLadder(d.ladderScale, +d.ladderCurrent, +d.ladderTarget);
      const max = C.LADDERS[d.ladderScale].levels.length - 1;
      if (!prev) lad.since = d.createdAt || today; else if (prev.current !== +d.ladderCurrent) lad.since = today;
      lad.current = Math.min(max, +d.ladderCurrent); lad.target = Math.max(Math.min(max, +d.ladderTarget), Math.max(0, lad.current));
      lad.hoursNext = d.ladderHours > 0 ? +d.ladderHours : C.LADDERS[d.ladderScale].hours[Math.min(lad.current + 1, max)];
      d.ladder = lad;
    } else d.ladder = null;
    ['unitKind', 'unitName', 'ladderScale', 'ladderCurrent', 'ladderTarget', 'ladderHours'].forEach((k) => delete d[k]);
    C.touch(d);
    if (modal.isNew) { d.id = C.uid(); d.createdAt = today; S.goals.push(C.newGoal(d)); }
    else Object.assign(old, d);
    closeModal(); commit();
  }

  // ---------- events ----------
  const actions = {
    nav: (el) => { view = el.dataset.view; render(); $('#main').scrollTop = 0; },
    range: (el) => { range = +el.dataset.n; render(); },
    log: (el) => addLog(el.dataset.id, +el.dataset.amt),
    logOther: (el) => openLog(el.dataset.id),
    timerStart: (el) => startTimer(el.dataset.id),
    timerStop: () => stopTimer(true),
    timerCancel: () => confirmDlg('Discard this session?', 'The time on the timer will not be logged.', 'Discard', () => stopTimer(false), true),
    taskToggle: (el) => {
      const g = goal(el.dataset.id); if (!g) return;
      if (g.doneDate) g.doneDate = null; else { g.doneDate = C.dateKey(now()); toast('✅', `${g.name}: done!`, `+${C.XP.task} XP`); confetti(70); }
      C.touch(g); commit();
    },
    goalNew: () => openGoal(null),
    goalEdit: (el) => openGoal(el.dataset.id),
    goalArchive: (el) => { const g = goal(el.dataset.id); g.archived = !g.archived; C.touch(g); if (g.archived && S.timer && S.timer.goalId === g.id) S.timer = null; commit(); },
    goalDelete: (el) => {
      const g = goal(el.dataset.id);
      confirmDlg(`Delete “${g.name}”?`, 'This removes the goal with all its entries and the XP it earned. To keep the history, archive it instead.', 'Delete', () => {
        S.goals = S.goals.filter((x) => x.id !== g.id); S.logs = S.logs.filter((l) => l.goalId !== g.id); S.deleted[g.id] = Date.now();
        if (S.timer && S.timer.goalId === g.id) S.timer = null; commit();
      }, true);
    },
    toggleEntries: (el) => { const id = el.dataset.id; expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); },
    logDelete: (el) => { S.logs = S.logs.filter((l) => l.id !== el.dataset.id); S.deleted[el.dataset.id] = Date.now(); commit(); },
    ladderUp: (el) => {
      const g = goal(el.dataset.id); const L = C.ladderStatus(ctx(), g); if (!L || L.maxed) return;
      confirmDlg(`Reached ${L.nextName}?`, `Mark ${g.name} as ${L.scale} ${L.nextName}. You earn ${C.XP.ladder} XP and the bar starts again toward the next level.`, `Yes, ${L.nextName} reached`, () => {
        C.ladderLevelUp(g, C.dateKey(now())); C.touch(g); toast('🎓', `${g.name}: ${L.nextName}`, `+${C.XP.ladder} XP`); confetti(200); commit();
      });
    },
    draft: (el) => { const d = modal.draft; d[el.dataset.f] = el.dataset.n ? +el.dataset.v : el.dataset.v; modal.err = ''; renderGoalForm(); },
    draftDay: (el) => { const d = modal.draft, x = +el.dataset.v; d.days = d.days.includes(x) ? d.days.filter((y) => y !== x) : d.days.concat([x]); renderGoalForm(); },
    tmpl: (el) => { Object.assign(modal.draft, TEMPLATES[+el.dataset.i][1]); modal.err = ''; renderGoalForm(); },
    modalClose: closeModal,
    modalOk: () => {
      if (!modal) return;
      if (modal.kind === 'confirm') { const f = modal.onOk; closeModal(); f(); }
      else if (modal.kind === 'goal') saveGoal();
      else if (modal.kind === 'log') {
        const a = parseFloat($('#l-amt').value), date = $('#l-date').value, today = C.dateKey(now());
        if (!(a > 0)) { $('#l-err').textContent = 'Enter an amount greater than zero.'; return; }
        if (!date || date > today) { $('#l-err').textContent = 'Pick today or an earlier day.'; return; }
        const id = modal.id, note = $('#l-note').value.trim(); closeModal(); addLog(id, a, date, note);
      }
    },
    testNotify: () => { api.notify('Questlog test notification', 'If you can read this, reminders will reach you.'); toast('🔔', 'Test sent', 'Check the corner of your screen'); },
    export: async () => { const p = await api.exportData(); if (p) toast('💾', 'Backup saved', p); },
    import: async () => { const r = await api.importData(); if (!r) return; if (r.error) return toast('⚠️', 'Import failed', r.error); const keep = S.sync; S = C.normalize(r.state); S.sync = keep; save(); if (sync) sync.schedule(500); lastLevel = C.levelInfo(C.computeXP(ctx()).total).level; render(); toast('📥', 'Backup restored', ''); },
    openFolder: () => api.openDataFolder(),
    openUrl: (el) => api.openUrl(el.dataset.url),
    syncConnect: async () => {
      const t = ($('#sync-token').value || '').trim();
      if (!t) return toast('🔑', 'Paste the token first', '');
      S.sync = Object.assign(S.sync || {}, { token: t, gistId: '' }); save(); render();
      const ok = await sync.run();
      if (!ok) { toast('⚠️', 'Could not connect', sync.status().message); if (sync.status().state === 'error') { S.sync.token = ''; save(); } render(); return; }
      if (!isWeb && !S.sync.pwaUrl) { const login = await sync.whoAmI(); if (login) { S.sync.pwaUrl = `https://${login.toLowerCase()}.github.io/questlog/`; save(); } }
      toast('🔄', 'Sync is on', 'This device is connected'); render();
    },
    syncNow: async () => { const ok = await sync.run(); toast(ok ? '🔄' : '⚠️', ok ? 'Synced' : 'Sync failed', ok ? '' : sync.status().message); if (view === 'settings') render(); },
    syncDisconnect: () => confirmDlg('Turn off sync on this device?', 'Your data stays on this device and in your GitHub account. Other devices are not affected.', 'Turn off', () => { S.sync = { pwaUrl: (S.sync || {}).pwaUrl || '' }; save(); render(); }),
    install: async () => { if (installEvt) { installEvt.prompt(); installEvt = null; render(); } },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled) { hideTip(); actions[el.dataset.act](el); return; }
    if (e.target.id === 'modal' && modal && modal.kind !== 'goal') closeModal();
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.f && modal && modal.kind === 'goal') {
      modal.draft[el.dataset.f] = el.dataset.n ? (el.value === '' ? '' : +el.value) : el.value;
      if (el.dataset.f === 'ladderScale' && el.value) { const d = modal.draft; d.ladderCurrent = -1; d.ladderTarget = Math.min(2, C.LADDERS[el.value].levels.length - 1); d.ladderHours = C.LADDERS[el.value].hours[0]; }
      if (el.dataset.f === 'ladderCurrent') { const d = modal.draft, L = C.LADDERS[d.ladderScale]; d.ladderHours = L.hours[Math.min(+d.ladderCurrent + 1, L.hours.length - 1)]; d.ladderTarget = Math.max(+d.ladderTarget, Math.min(+d.ladderCurrent + 1, L.levels.length - 1)); }
      if (el.dataset.re) renderGoalForm();
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.sync) { S.sync = S.sync || {}; let v = el.value.trim(); if (v && !/^https?:\/\//.test(v)) v = 'https://' + v; if (v && !v.endsWith('/') && !/\.html$/.test(v)) v += '/'; S.sync[el.dataset.sync] = v; save(); render(); return; }
    if (!el.dataset.set) return;
    S.settings[el.dataset.set] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.set === 'summaryTime' && !el.value) S.settings.summaryTime = '21:00';
    save(); if (el.dataset.set === 'theme') applyTheme();
  });
  document.addEventListener('keydown', (e) => {
    if (!modal) return;
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT') actions.modalOk();
  });

  // tooltips
  const tipEl = $('#tip');
  function hideTip() { tipEl.hidden = true; }
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return hideTip();
    tipEl.textContent = el.dataset.tip; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 16;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
    tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
  });
  document.addEventListener('mouseleave', hideTip);
  document.addEventListener('touchstart', () => setTimeout(hideTip, 2500), { passive: true });
  $('#main').addEventListener('scroll', hideTip);

  // toasts + confetti
  function toast(icon, title, text) {
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = `<span class="i">${esc(icon)}</span><div><b>${esc(title)}</b><span>${esc(text || '')}</span></div>`;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3600);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  }
  let parts = [], raf = 0;
  function confetti(n) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('#confetti'); cv.width = innerWidth; cv.height = innerHeight;
    const cols = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
    for (let i = 0; i < n; i++) parts.push({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 3, s: 4 + Math.random() * 5, c: cols[i % cols.length], r: Math.random() * 6, life: 0 });
    if (raf) return;
    const g = cv.getContext('2d');
    const step = () => {
      g.clearRect(0, 0, cv.width, cv.height);
      parts = parts.filter((p) => p.life < 110 && p.y < cv.height + 20);
      for (const p of parts) { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += 0.2; p.life++; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = Math.max(0, 1 - p.life / 110); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); g.restore(); }
      raf = parts.length ? requestAnimationFrame(step) : 0;
      if (!raf) g.clearRect(0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(step);
  }

  function applyTheme() { /* the main process switches the native theme; in a browser preview follow the OS */ }

  // ---------- boot ----------
  function applyMerged(doc) { // changes arrived from another device
    C.applyDoc(S, doc); C.unlockAchievements(S, now()); save();
    lastLevel = C.levelInfo(C.computeXP(ctx()).total).level;
    if (modal) needRender = true; else render();
  }
  (async function init() {
    try { info = Object.assign(info, await api.info()); } catch (e) { /* preview */ }
    S = C.normalize(await api.getState());
    const link = Sync.parseLink(location.hash); // opened from the QR code shown on another device
    if (link) { S.sync = Object.assign(S.sync || {}, link); history.replaceState(null, '', location.pathname + location.search); }
    C.unlockAchievements(S, now()); // quietly catch up
    save();
    lastLevel = C.levelInfo(C.computeXP(ctx()).total).level;
    api.onStateReplaced((s) => { const keep = S.sync; S = C.normalize(s); S.sync = keep; render(); });
    document.documentElement.classList.toggle('web', isWeb);
    render();
    if (typeof fetch === 'function' && !/demo/.test(location.search)) {
      sync = Sync.create({
        fetch: (u, o) => fetch(u, o), getState: () => S, getCfg: () => S.sync || {}, saveCfg: save, applyMerged,
        onStatus: () => { const el = $('#sync-status'); if (el) el.textContent = syncStatusText(); },
      });
      sync.run().then((ok) => { if (link) toast(ok ? '🔄' : '⚠️', ok ? 'Connected' : 'Could not connect', ok ? 'This phone now syncs with your computer' : sync.status().message); });
      setInterval(() => { if (!document.hidden || !isWeb) sync.run(); }, 90000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.run(); });
      window.addEventListener('online', () => sync.run());
    }
    setInterval(() => {
      if (S.timer) renderTimer();
      if (C.dateKey(now()) !== lastDay && !modal) render(); // new day
    }, 1000);
    window.addEventListener('focus', () => { if (!modal && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) render(); if (sync && !isWeb) sync.run(); });
    let rz = 0, lastW = innerWidth;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (innerWidth !== lastW && !modal) { lastW = innerWidth; render(); } }, 200); });
    if (isWeb) {
      window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (view === 'settings' && !modal) render(); });
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
  window.__questlog = { state: () => S, setView: (v) => { view = v; render(); } };
})();
