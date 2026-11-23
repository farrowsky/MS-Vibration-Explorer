// Small SVG charts (no library): scatter/line with a tolerance line, stacked bar.
import { esc } from './dom.js';
import { fmt } from './units.js';

function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
  const t = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}

// series: [{name, color, points:[{x,y,label}], line:true, dash, size}]
export function scatter({ series, xLabel, yLabel, xLine, xLineLabel, width = 340, height = 230, xMin, xMax, yMin, yMax, onHover }) {
  const pad = { l: 46, r: 12, t: 12, b: 36 };
  const pts = series.flatMap(s => s.points).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  let x0 = xMin ?? Math.min(...pts.map(p => p.x), xLine ?? Infinity), x1 = xMax ?? Math.max(...pts.map(p => p.x), xLine ?? -Infinity);
  let y0 = yMin ?? Math.min(...pts.map(p => p.y)), y1 = yMax ?? Math.max(...pts.map(p => p.y));
  if (!pts.length) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  const xr = (x1 - x0) || 1, yr = (y1 - y0) || 1;
  x0 -= xr * 0.08; x1 += xr * 0.08; y0 -= yr * 0.12; y1 += yr * 0.12;
  if (x0 < 0 && (xMin ?? 0) >= 0) x0 = 0;
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const X = v => pad.l + (v - x0) / (x1 - x0) * W, Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * H;
  let s = `<svg viewBox="0 0 ${width} ${height}" role="img">`;
  s += '<g class="grid">';
  for (const t of niceTicks(y0, y1, 4)) s += `<line x1="${pad.l}" x2="${pad.l + W}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 6}" y="${Y(t) + 3}" text-anchor="end">${fmt(t, 2)}</text>`;
  for (const t of niceTicks(x0, x1, 5)) s += `<line y1="${pad.t}" y2="${pad.t + H}" x1="${X(t)}" x2="${X(t)}" opacity=".5"/><text x="${X(t)}" y="${pad.t + H + 14}" text-anchor="middle">${fmt(t, 2)}</text>`;
  s += '</g>';
  if (Number.isFinite(xLine)) {
    s += `<line x1="${X(xLine)}" x2="${X(xLine)}" y1="${pad.t}" y2="${pad.t + H}" stroke="currentColor" stroke-dasharray="4 3" stroke-width="1.4" style="color:var(--text)" opacity=".7"/>`;
    if (xLineLabel) s += `<text x="${X(xLine) + 4}" y="${pad.t + 10}" style="fill:var(--text)">${esc(xLineLabel)}</text>`;
  }
  for (const se of series) {
    const p = se.points.filter(q => Number.isFinite(q.x) && Number.isFinite(q.y));
    if (se.line && p.length > 1) s += `<polyline fill="none" stroke="${se.color}" stroke-width="1.6" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} opacity=".85" points="${p.map(q => `${X(q.x)},${Y(q.y)}`).join(' ')}"/>`;
    for (const q of p) {
      const r = q.size ?? se.size ?? 3.2;
      s += `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="${r}" fill="${q.color || se.color}" stroke="${q.ring ? 'var(--text)' : 'rgba(0,0,0,.35)'}" stroke-width="${q.ring ? 2 : 0.8}"${q.label ? ` data-tip="${esc(q.label)}"` : ''}><title>${esc(q.label || se.name)}</title></circle>`;
    }
  }
  s += `<text x="${pad.l + W / 2}" y="${height - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
  s += `<text transform="translate(11 ${pad.t + H / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  return s + '</svg>';
}

// Interactive version: nearest-point hover with guide lines and a tooltip, click to pick,
// legend buttons that show / hide a series (series sharing a name toggle together).
// points may carry { tip: html, key } -- tip is shown on hover, key is passed to onPick.
export function interactiveScatter(el, opts) {
  const { series, legend = true, onPick, width = 360, height = 250 } = opts;
  const hidden = opts.hidden || new Set();
  const draw = () => {
    const vis = series.filter(s => !hidden.has(s.name));
    const pad = { l: 50, r: 14, t: 14, b: 38 };
    const all = series.flatMap(s => s.points).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const xLine = opts.xLine;
    // axes fixed to every series so toggling does not rescale
    let x0 = opts.xMin ?? Math.min(...all.map(p => p.x), xLine ?? Infinity), x1 = Math.max(...all.map(p => p.x), xLine ?? -Infinity);
    let y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
    if (!all.length) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    const xr = (x1 - x0) || 1, yr = (y1 - y0) || 1;
    x0 -= xr * 0.06; x1 += xr * 0.06; y0 -= yr * 0.1; y1 += yr * 0.1;
    if (x0 < 0 && (opts.xMin ?? 0) >= 0) x0 = 0;
    const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
    const X = v => pad.l + (v - x0) / (x1 - x0) * W, Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * H;
    let s = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.yLabel)} against ${esc(opts.xLabel)}">`;
    s += '<g class="grid">';
    for (const t of niceTicks(y0, y1, 5)) s += `<line x1="${pad.l}" x2="${pad.l + W}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 6}" y="${Y(t) + 3}" text-anchor="end">${fmt(t, 2)}</text>`;
    for (const t of niceTicks(x0, x1, 6)) s += `<line y1="${pad.t}" y2="${pad.t + H}" x1="${X(t)}" x2="${X(t)}" opacity=".5"/><text x="${X(t)}" y="${pad.t + H + 14}" text-anchor="middle">${fmt(t, 2)}</text>`;
    s += '</g>';
    if (Number.isFinite(xLine)) {
      s += `<rect x="${X(xLine)}" y="${pad.t}" width="${Math.max(0, pad.l + W - X(xLine))}" height="${H}" fill="var(--fail)" opacity=".05"/>`;
      s += `<line x1="${X(xLine)}" x2="${X(xLine)}" y1="${pad.t}" y2="${pad.t + H}" stroke="currentColor" stroke-dasharray="4 3" stroke-width="1.4" style="color:var(--text)" opacity=".7"/>`;
      if (opts.xLineLabel) s += `<text x="${X(xLine) + 4}" y="${pad.t + 10}" style="fill:var(--text)">${esc(opts.xLineLabel)}</text>`;
    }
    const hits = [];
    vis.forEach((se, si) => {
      const p = se.points.filter(q => Number.isFinite(q.x) && Number.isFinite(q.y));
      if (se.line && p.length > 1) s += `<polyline data-s="${si}" fill="none" stroke="${se.color}" stroke-width="1.8" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} opacity=".85" points="${p.map(q => `${X(q.x)},${Y(q.y)}`).join(' ')}"/>`;
      for (const q of p) {
        const r = q.size ?? se.size ?? 3.2;
        hits.push({ q, se, si, px: X(q.x), py: Y(q.y), r });
        s += `<circle class="pt" data-h="${hits.length - 1}" cx="${X(q.x)}" cy="${Y(q.y)}" r="${r}" fill="${q.color || se.color}" stroke="${q.ring ? 'var(--text)' : 'rgba(0,0,0,.35)'}" stroke-width="${q.ring ? 2 : 0.8}"/>`;
      }
    });
    s += `<line class="guide" id="gx" x1="0" x2="0" y1="0" y2="0" visibility="hidden"/><line class="guide" id="gy" x1="0" x2="0" y1="0" y2="0" visibility="hidden"/>`;
    s += `<text x="${pad.l + W / 2}" y="${height - 4}" text-anchor="middle">${esc(opts.xLabel)}</text>`;
    s += `<text transform="translate(12 ${pad.t + H / 2}) rotate(-90)" text-anchor="middle">${esc(opts.yLabel)}</text>`;
    s += '</svg>';
    const names = [];
    for (const se of series) if (se.legend !== false && !names.find(n => n.name === se.name)) names.push({ name: se.name, color: se.color });
    el.innerHTML = `<div class="ichart">${s}<div class="chart-tip" hidden></div></div>` +
      (legend ? `<div class="legend">${names.map(n => `<button type="button" data-n="${esc(n.name)}" class="${hidden.has(n.name) ? 'off' : ''}" title="Show / hide"><i style="background:${n.color}"></i>${esc(n.name)}</button>`).join('')}</div>` : '');
    const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), box = el.querySelector('.ichart');
    const gx = svg.querySelector('#gx'), gy = svg.querySelector('#gy');
    let cur = null;
    const toUser = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
    const show = (h) => {
      if (cur === h) return;
      if (cur) { const c = svg.querySelector(`circle[data-h="${hits.indexOf(cur)}"]`); c?.setAttribute('r', cur.r); svg.querySelectorAll('polyline').forEach(pl => pl.setAttribute('stroke-width', '1.8')); }
      cur = h;
      if (!h) { tip.hidden = true; gx.setAttribute('visibility', 'hidden'); gy.setAttribute('visibility', 'hidden'); return; }
      svg.querySelector(`circle[data-h="${hits.indexOf(h)}"]`)?.setAttribute('r', h.r * 1.7 + 1.5);
      svg.querySelectorAll(`polyline[data-s="${h.si}"]`).forEach(pl => pl.setAttribute('stroke-width', '3.2'));
      gx.setAttribute('x1', h.px); gx.setAttribute('x2', h.px); gx.setAttribute('y1', h.py); gx.setAttribute('y2', pad.t + H); gx.setAttribute('visibility', 'visible');
      gy.setAttribute('x1', pad.l); gy.setAttribute('x2', h.px); gy.setAttribute('y1', h.py); gy.setAttribute('y2', h.py); gy.setAttribute('visibility', 'visible');
      tip.innerHTML = h.q.tip || `<b>${esc(h.q.label || h.se.name)}</b><div class="tt-s">${fmt(h.q.x, 3)}, ${fmt(h.q.y, 2)}</div>`;
      const sc = svg.clientWidth / width;
      tip.style.left = `${h.px * sc}px`; tip.style.top = `${h.py * sc}px`;
      tip.hidden = false;
      // keep the tooltip inside the chart
      const tw = tip.offsetWidth, bw = box.clientWidth;
      const left = Math.max(tw / 2 + 2, Math.min(bw - tw / 2 - 2, h.px * sc));
      tip.style.left = `${left}px`;
      svg.style.cursor = h.q.key && onPick ? 'pointer' : 'default';
    };
    svg.onmousemove = (e) => {
      const u = toUser(e);
      const thr = 22 * width / Math.max(1, svg.clientWidth);
      let best = null, bd = thr;
      for (const h of hits) { const d = Math.hypot(h.px - u.x, h.py - u.y); if (d < bd || (d === bd && h.q.key)) { bd = d; best = h; } }
      show(best);
    };
    svg.onmouseleave = () => show(null);
    svg.onclick = () => { if (cur?.q.key && onPick) onPick(cur.q.key); };
    el.querySelectorAll('.legend button').forEach(b => b.onclick = () => { const n = b.dataset.n; hidden.has(n) ? hidden.delete(n) : hidden.add(n); draw(); opts.onToggle?.(hidden); });
  };
  draw();
  return { redraw: draw, hidden };
}

export function stackedBar(parts, { width = 340, height = 34 } = {}) {
  const tot = parts.reduce((a, p) => a + Math.max(0, p.value || 0), 0) || 1;
  let x = 0, s = `<svg viewBox="0 0 ${width} ${height}">`;
  for (const p of parts) {
    const w = Math.max(0, p.value || 0) / tot * width;
    s += `<rect x="${x}" y="4" width="${Math.max(0, w - 1)}" height="${height - 8}" rx="3" fill="${p.color}"><title>${esc(p.label)}: ${fmt(p.value, 0)} (${fmt(100 * p.value / tot, 1)}%)</title></rect>`;
    if (w > 34) s += `<text x="${x + w / 2}" y="${height / 2 + 4}" text-anchor="middle" style="fill:#0a0e13;font-weight:700">${fmt(100 * p.value / tot, 0)}%</text>`;
    x += w;
  }
  return s + '</svg>';
}
