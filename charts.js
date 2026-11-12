/* Small hand-rolled SVG/HTML charts. Each returns an HTML string; tooltips use [data-tip]. */
(function () {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtDay = (k) => { const d = Core.parseKey(k); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const shortDay = (k) => { const d = Core.parseKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 5 ? 5 : 10) * p;
  }
  function timeAxis(mins) { // nice step + max for a minutes axis, at most 4 intervals
    const steps = [10, 15, 20, 30, 60, 120, 180, 240, 360, 480];
    const step = steps.find((x) => Math.ceil(mins / x) <= 4) || Math.ceil(mins / 4 / 60) * 60;
    return { step, max: Math.max(1, Math.ceil(mins / step)) * step };
  }
  const fmtAxisMin = (m) => (m >= 60 ? (m % 60 ? (m / 60).toFixed(1) + 'h' : m / 60 + 'h') : m + 'm');

  function ring(pct, size, stroke, color, inner) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, pct || 0));
    return `<div class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
        <circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      </svg><div class="c">${inner || ''}</div></div>`;
  }

  /* Stacked bars: days[] of date keys, series[{name,color,values[]}] in minutes. */
  function stackedBars({ days, series, height, width }) {
    const W = Math.max(280, Math.round(width || 1000)), H = height || 220, L = 40, R = 8, T = 10, B = 24;
    const pw = W - L - R, ph = H - T - B;
    const totals = days.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
    const ax = timeAxis(Math.max(1, ...totals)); const max = ax.max;
    const step = pw / days.length; const bw = Math.max(1.5, Math.min(34, step * 0.62));
    const y = (v) => T + ph - (v / max) * ph;
    let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="Minutes per day by goal">`;
    for (let v = 0; v <= max; v += ax.step) {
      out += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtAxisMin(Math.round(v))}</text>`;
    }
    const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(pw / 62))));
    days.forEach((d, i) => {
      const cx = L + step * i + step / 2; let acc = 0;
      const present = series.map((s, si) => ({ s, v: s.values[i] || 0, si })).filter((p) => p.v > 0);
      present.forEach((p, pi) => {
        const y0 = y(acc), y1 = y(acc + p.v); acc += p.v;
        const top = pi === present.length - 1;
        const h = Math.max(1, y0 - y1 - (top ? 0 : 2)); // 2px surface gap between segments
        const x = cx - bw / 2, yy = y0 - h, rr = top ? Math.min(4, h, bw / 2) : 0;
        out += rr
          ? `<path d="M${x},${yy + h}V${yy + rr}a${rr},${rr} 0 0 1 ${rr},-${rr}h${bw - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${yy + h}Z" fill="${p.s.color}"/>`
          : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="${p.s.color}"/>`;
      });
      if ((days.length - 1 - i) % every === 0) out += `<text x="${i === days.length - 1 ? Math.min(W - 2, cx + 16) : cx}" y="${H - 6}" text-anchor="${i === days.length - 1 ? 'end' : 'middle'}">${days.length <= 14 ? DAYS[Core.parseKey(d).getDay()] + ' ' + Core.parseKey(d).getDate() : shortDay(d)}</text>`;
      const tip = [fmtDay(d) + ' · ' + Core.fmtAmount(totals[i], 'min')].concat(present.slice().reverse().map((p) => `${p.s.name}: ${Core.fmtAmount(p.v, 'min')}`)).join('\n');
      out += `<rect class="hit" x="${L + step * i}" y="${T}" width="${step}" height="${ph}" data-tip="${esc(tip)}"/>`;
    });
    out += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line-strong)"/></svg>`;
    return out;
  }

  /* Activity heatmap by XP per day, Monday-first columns. */
  function heatmap({ byDate, weeks, today }) {
    const start = Core.addDays(Core.weekStart(today), -7 * (weeks - 1));
    const vals = []; for (let i = 0; i < weeks * 7; i++) { const d = Core.addDays(start, i); if (d <= today) vals.push(byDate[d] || 0); }
    const max = Math.max(60, ...vals);
    const lvl = (v) => (v <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
    let cols = ''; let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const ws = Core.addDays(start, w * 7); const m = Core.parseKey(ws).getMonth();
      const nextM = Core.parseKey(Core.addDays(ws, 7)).getMonth();
      let col = `<div class="col"><div class="m">${m !== lastMonth && nextM === m ? MONTHS[m] : ''}</div>`; if (nextM === m) lastMonth = m;
      for (let i = 0; i < 7; i++) {
        const d = Core.addDays(ws, i);
        if (d > today) { col += '<div class="cell x"></div>'; continue; }
        const v = byDate[d] || 0;
        col += `<div class="cell" style="background:var(--h${lvl(v)})" data-tip="${esc(fmtDay(d) + '\n' + (v ? v + ' XP' : 'No activity'))}"></div>`;
      }
      cols += col + '</div>';
    }
    return `<div class="heat"><div class="hl"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div><div class="cols">${cols}</div></div>
      <div class="heat-scale">Less <i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i> More XP</div>`;
  }

  function hbars(items, fmt) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return `<div class="hbars">${items.map((i) => `<div class="n">${esc(i.name)}</div><div><div class="b" style="--c:${i.color};width:${(i.value / max) * 100}%" data-tip="${esc(i.name + ': ' + fmt(i.value))}"></div></div><div class="v">${fmt(i.value)}</div>`).join('')}</div>`;
  }

  /* Burn-up: cumulative actual vs. even pace to the target. */
  function burnup({ start, deadline, today, cumulative, target, unit, color, width }) {
    const W = Math.max(280, Math.round(width || 520)), H = 190, L = 36, R = 12, T = 14, B = 24;
    const end = deadline > today ? deadline : today;
    const n = Math.max(1, Core.daysBetween(start, end));
    const dl = Math.max(1, Core.daysBetween(start, deadline) + 1);
    const lastVal = cumulative.length ? cumulative[cumulative.length - 1].v : 0;
    const max = niceMax(Math.max(target, lastVal));
    const pw = W - L - R, ph = H - T - B;
    const x = (i) => L + (i / n) * pw, y = (v) => T + ph - (v / max) * ph;
    let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="Progress toward target">`;
    for (let i = 0; i <= 2; i++) { const v = (max / 2) * i; out += `<line class="gridl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 10) / 10}</text>`; }
    out += `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="2 4"/>`;
    out += `<text x="${W - R}" y="${y(target) - 5}" text-anchor="end">Target ${target} ${esc(unit)}</text>`;
    // even pace: 0 at the start of day one, target at the end of the deadline day
    const dIdx = Core.daysBetween(start, deadline);
    out += `<line x1="${x(0)}" y1="${y(target / dl)}" x2="${x(dIdx)}" y2="${y(target)}" stroke="var(--text-3)" stroke-width="2" stroke-dasharray="6 5"/>`;
    const pts = cumulative.map((p, i) => `${x(i)},${y(p.v)}`);
    if (pts.length === 1) out += `<circle cx="${x(0)}" cy="${y(cumulative[0].v)}" r="4" fill="${color}"/>`;
    else out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (cumulative.length) { const li = cumulative.length - 1; out += `<circle cx="${x(li)}" cy="${y(lastVal)}" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`; }
    out += `<text x="${x(0)}" y="${H - 6}" text-anchor="start">${shortDay(start)}</text><text x="${x(dIdx)}" y="${H - 6}" text-anchor="${dIdx === n ? 'end' : 'middle'}">${shortDay(deadline)} (deadline)</text>`;
    const cw = pw / n;
    for (let i = 0; i <= n; i++) {
      const d = Core.addDays(start, i); const pace = Math.min(target, (target * (i + 1)) / dl);
      const a = cumulative[i]; const tip = fmtDay(d) + (a ? `\nDone: ${Math.round(a.v * 10) / 10} ${unit}` : '') + (i <= dIdx ? `\nEven pace: ${Math.round(pace * 10) / 10} ${unit}` : '');
      out += `<rect class="hit" x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${ph}" data-tip="${esc(tip)}"/>`;
    }
    return out + '</svg>';
  }

  window.Charts = { esc, ring, stackedBars, heatmap, hbars, burnup, fmtDay, shortDay, MONTHS, DAYS };
})();
