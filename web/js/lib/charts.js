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
