// 2D figures for the calculation report, drawn as SVG from one design's captured values. Every number printed on a
// figure is a captured value of the paper's solver; geometry is drawn to scale where the caption says so. The figures
// re-draw from whatever design the report is built for, so they always match the calculations next to them.
import { esc } from '../lib/dom.js';
import { fmt, fmtFixed, FT2_PER_M2 } from '../lib/units.js';

const COL = {
  steel: '#5b6b7b', steelFill: '#d9dfe6', conc: '#c9d1d9', concDark: '#9aa6b2', comp: '#4178BE', ten: '#E57373',
  pna: '#b83c3c', text: '#14202b', muted: '#5d6b78', line: '#d6dde5', girder: '#FCAE2E', infill: '#4178BE',
  pass: '#5f7d22', fail: '#b83c3c', warn: '#b37400', trib: '#85C1E9',
};
const n = (x) => (Number.isFinite(x) ? x : null);
const T = (x, y, s, { size = 11, anchor = 'start', fill = COL.text, weight = 400, cls = '' } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" text-anchor="${anchor}" fill="${fill}" font-weight="${weight}"${cls ? ` class="${cls}"` : ''}>${s}</text>`;
const L = (x1, y1, x2, y2, { stroke = COL.text, w = 1, dash = '' } = {}) =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const R = (x, y, w, h, { fill = 'none', stroke = 'none', sw = 1, op = 1 } = {}) =>
  `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op < 1 ? ` fill-opacity="${op}"` : ''}/>`;
const svg = (w, h, body, label) => `<svg class="fig" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" font-family="-apple-system,'Segoe UI',Roboto,Arial,sans-serif">${body}</svg>`;
const ARROW = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>`;
const arrow = (x1, y1, x2, y2, stroke = COL.text, w = 1.4) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}" marker-end="url(#ah)"/>`;
// horizontal dimension line with ticks and a centred label
const dimH = (x1, x2, y, label, { color = COL.muted } = {}) =>
  L(x1, y, x2, y, { stroke: color }) + L(x1 - 3, y + 3, x1 + 3, y - 3, { stroke: color, w: 1.3 }) + L(x2 - 3, y + 3, x2 + 3, y - 3, { stroke: color, w: 1.3 }) +
  T((x1 + x2) / 2, y - 4, label, { size: 10, anchor: 'middle', fill: color });
const dimV = (x, y1, y2, label, { color = COL.muted, side = 'right' } = {}) =>
  L(x, y1, x, y2, { stroke: color }) + L(x - 3, y1 + 3, x + 3, y1 - 3, { stroke: color, w: 1.3 }) + L(x - 3, y2 + 3, x + 3, y2 - 3, { stroke: color, w: 1.3 }) +
  T(side === 'right' ? x + 5 : x - 5, (y1 + y2) / 2 + 3.5, label, { size: 10, anchor: side === 'right' ? 'start' : 'end', fill: color });

// a captured value as a number: (1, n) / (n, 1) values are reduced already; per-option lists (studs per rib) are
// read at the option the solver selected
export function pick(v, name) {
  const x = v[name];
  if (!Array.isArray(x)) return n(x);
  if (x.length === 1) return n(x[0]);
  const m = name.slice(-2);
  const opts = v[`studs_per_rib_${m}`], sel = v[`min_studs_per_rib_${m}`];
  const i = Array.isArray(opts) ? opts.indexOf(sel) : -1;
  return i >= 0 ? n(x[i]) : n(x.find(Number.isFinite));
}
const pickStr = (v, name) => { const x = v[name]; return Array.isArray(x) ? x[0] : x; };

// ---------------------------------------------------------------------------------------------------------------
// framing plan with tributary widths (to scale)
export function framingPlan(v) {
  const Lg = v.Girder_Span, Lj = v.Infill_Span, N = v.NumInfill, s = v.infill_spacing;
  const W = 640, H = 330, pad = { l: 60, r: 170, t: 34, b: 46 };
  const k = Math.min((W - pad.l - pad.r) / Lg, (H - pad.t - pad.b) / Lj);
  const x0 = pad.l, y0 = pad.t, X = (x) => x0 + x * k, Y = (z) => y0 + z * k;
  let b = '';
  // tributary of a typical (first interior) infill and of one girder (half the bay)
  const xi = s, tribI = n(v.Trib_II) ?? s;
  b += R(X(xi - tribI / 2), Y(0), tribI * k, Lj * k, { fill: COL.trib, op: 0.28 });
  b += R(X(0), Y(0), Lg * k, (Lj / 2) * k, { fill: COL.girder, op: 0.10 });
  // members
  for (let q = 1; q <= N; q++) b += L(X(q * s), Y(0), X(q * s), Y(Lj), { stroke: COL.infill, w: q === 1 ? 3 : 2 });
  b += L(X(0), Y(0), X(0), Y(Lj), { stroke: COL.infill, w: 2, dash: '5 3' }) + L(X(Lg), Y(0), X(Lg), Y(Lj), { stroke: COL.infill, w: 2, dash: '5 3' });
  b += L(X(0), Y(0), X(Lg), Y(0), { stroke: COL.girder, w: 4 }) + L(X(0), Y(Lj), X(Lg), Y(Lj), { stroke: COL.girder, w: 4 });
  for (const [x, z] of [[0, 0], [Lg, 0], [0, Lj], [Lg, Lj]]) b += R(X(x) - 5, Y(z) - 5, 10, 10, { fill: COL.steel });
  // deck span direction (ribs run parallel to the girders)
  b += T(X(Lg) - 8, Y(Lj * 0.5) + 4, 'deck ribs ⟷', { size: 10, anchor: 'end', fill: COL.muted });
  // dimensions
  b += dimH(X(0), X(Lg), Y(Lj) + 26, `L<tspan baseline-shift="sub" font-size="8">g</tspan> = ${fmt(Lg, 2)} ft (girder span)`);
  b += dimV(X(0) - 22, Y(0), Y(Lj), `L<tspan baseline-shift="sub" font-size="8">j</tspan> = ${fmt(Lj, 2)} ft`, { side: 'left' });
  b += dimH(X(0), X(s), Y(0) - 14, `s = ${fmt(s, 3)} ft`);
  // legend
  const lx = W - pad.r + 18; let ly = pad.t + 4;
  const leg = (sw, txt) => { b += sw(lx, ly) + T(lx + 26, ly + 4, txt, { size: 10.5 }); ly += 22; };
  leg((x, y) => L(x, y, x + 18, y, { stroke: COL.girder, w: 4 }), 'Girders (2)');
  leg((x, y) => L(x, y, x + 18, y, { stroke: COL.infill, w: 2.5 }), `Interior infills (${N})`);
  leg((x, y) => R(x, y - 6, 18, 12, { fill: COL.trib, op: 0.4 }), `Infill tributary ${fmt(tribI, 3)} ft`);
  leg((x, y) => R(x, y - 6, 18, 12, { fill: COL.girder, op: 0.18 }), `Girder tributary ${fmt(n(v.Trib_IG) ?? Lj, 3)} ft`);
  b += T(lx + 26, ly - 9, '(half from this bay, shaded)', { size: 9, fill: COL.muted });
  ly += 6;
  ly += 6;
  const ld = [['LL', v.LL, 'psf'], ['SDL', v.SDL, 'psf'], ['Slab + deck', v.Final_Slab_SW, 'psf'], ['Added topping', v.Additional_Topping_Load || 0, 'psf']].filter(r => r[1] || r[0] !== 'Added topping');
  b += T(lx, ly, 'Area loads (solver)', { size: 10.5, weight: 700 }); ly += 16;
  for (const [a, val, u] of ld) { b += T(lx, ly, `${a}`, { size: 10.5, fill: COL.muted }) + T(lx + 140, ly, `${fmt(val, 1)} ${u}`, { size: 10.5, anchor: 'end' }); ly += 15; }
  return svg(W, H, b, 'Framing plan with tributary widths');
}

// ---------------------------------------------------------------------------------------------------------------
// beam: elevation with loads, shear and moment diagrams (values from the solver; diagram shape from the load type)
export function beamDiagram({ title, span, kind, nLoads = 0, spacing = 0, Vu, Mu, phiMn, phiVn, loadTxt, color }) {
  const W = 640, H = 330, x0 = 70, x1 = W - 40, Lpx = x1 - x0;
  const X = (x) => x0 + (x / span) * Lpx;
  // unit-load shapes, scaled so the peaks equal the solver's Vu and Mu
  const pts = [];
  const NP = 120;
  let Mshape = (x) => x * (span - x) / 2;                  // UDL, w = 1
  let Vshape = (x) => span / 2 - x;
  if (kind === 'points' && nLoads > 0) {
    const P = Array.from({ length: nLoads }, (_, q) => (q + 1) * spacing);
    const Ra = nLoads / 2;                                  // symmetric equal point loads, P = 1
    Mshape = (x) => Ra * x - P.filter(p => p < x).reduce((a, p) => a + (x - p), 0);
    Vshape = (x) => Ra - P.filter(p => p < x).length;
  }
  let mMax = 0, vMax = 0;
  for (let i = 0; i <= NP; i++) { const x = span * i / NP; mMax = Math.max(mMax, Mshape(x)); vMax = Math.max(vMax, Math.abs(Vshape(x))); }
  const mS = mMax > 0 ? Mu / mMax : 0, vS = vMax > 0 ? Vu / vMax : 0;
  let b = ARROW;
  // elevation
  const yb = 62;
  b += T(x0 - 60, 16, `<tspan font-weight="700">${esc(title)}</tspan>  <tspan fill="${COL.muted}">${esc(loadTxt)}</tspan>`, { size: 11 });
  b += R(x0, yb - 5, Lpx, 10, { fill: color, op: 0.85 });
  b += `<path d="M${x0} ${yb + 5} l-8 14 h16z" fill="none" stroke="${COL.text}"/><path d="M${x1} ${yb + 5} l-8 14 h16z" fill="none" stroke="${COL.text}"/>`;
  if (kind === 'points') {
    for (let q = 1; q <= nLoads; q++) b += arrow(X(q * spacing), yb - 34, X(q * spacing), yb - 7, COL.text, 1.6);
    b += T(X(spacing) + 6, yb - 26, 'infill reactions', { size: 9.5, fill: COL.muted });
  } else {
    for (let i = 0; i <= 12; i++) b += arrow(x0 + Lpx * i / 12, yb - 26, x0 + Lpx * i / 12, yb - 7, COL.text, 1);
    b += L(x0, yb - 26, x1, yb - 26);
  }
  b += dimH(x0, x1, yb + 32, `${fmt(span, 2)} ft`);
  // shear
  const ys = 150, hs = 36;
  let p = `M${x0} ${ys}`;
  for (let i = 0; i <= NP; i++) { const x = span * i / NP; p += ` L${X(x).toFixed(1)} ${(ys - Vshape(x) * vS / Vu * hs).toFixed(1)}`; }
  b += `<path d="${p} L${x1} ${ys} Z" fill="${COL.comp}" fill-opacity=".14" stroke="${COL.comp}" stroke-width="1.4"/>` + L(x0, ys, x1, ys, { stroke: COL.muted });
  b += T(x0 - 8, ys + 4, 'V', { size: 11, anchor: 'end', weight: 700 });
  b += T(x0 + 4, ys - hs - 4, `V<tspan baseline-shift="sub" font-size="8">u</tspan> = ${fmt(Vu, 2)} kips`, { size: 10.5 }) +
    (n(phiVn) ? T(x1, ys - hs - 4, `φV<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(phiVn, 1)} kips (${fmt(100 * Vu / phiVn, 0)} %)`, { size: 10.5, anchor: 'end', fill: COL.muted }) : '');
  // moment (drawn downward, as on a drawing); capacity line if it fits on the scale
  const ym = 230, hm = 70;
  const mTop = Math.max(Mu, n(phiMn) && phiMn < Mu * 3.5 ? phiMn : 0);
  const mk = hm / (mTop || 1);
  p = `M${x0} ${ym}`;
  for (let i = 0; i <= NP; i++) { const x = span * i / NP; p += ` L${X(x).toFixed(1)} ${(ym + Mshape(x) * mS * mk).toFixed(1)}`; }
  b += `<path d="${p} L${x1} ${ym} Z" fill="${COL.ten}" fill-opacity=".16" stroke="${COL.ten}" stroke-width="1.4"/>` + L(x0, ym, x1, ym, { stroke: COL.muted });
  b += T(x0 - 8, ym + 4, 'M', { size: 11, anchor: 'end', weight: 700 });
  const xm = X(span / 2);
  b += T(xm, ym + Mu * mk + 14, `M<tspan baseline-shift="sub" font-size="8">u</tspan> = ${fmt(Mu, 1)} kip·ft`, { size: 10.5, anchor: 'middle', weight: 700 });
  if (n(phiMn)) {
    if (phiMn <= mTop) b += L(x0, ym + phiMn * mk, x1, ym + phiMn * mk, { stroke: COL.pass, w: 1.4, dash: '6 4' }) +
      T(x1, ym + phiMn * mk - 4, `φM<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(phiMn, 1)} kip·ft`, { size: 10.5, anchor: 'end', fill: COL.pass });
    else b += T(x1, ym + hm + 14, `φM<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(phiMn, 1)} kip·ft (off scale)`, { size: 10.5, anchor: 'end', fill: COL.pass });
    b += T(x0 - 60, H - 8, `Flexure: M<tspan baseline-shift="sub" font-size="8">u</tspan> / φM<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(100 * Mu / phiMn, 0)} %`, { size: 10.5, fill: Mu <= phiMn ? COL.pass : COL.fail, weight: 700 });
  }
  return svg(W, H, b, `${title}: loads, shear and moment`);
}

// ---------------------------------------------------------------------------------------------------------------
// composite section and plastic stress distribution (AISC 360 I3), drawn to scale vertically
export function stressBlock(v, m, title) {
  const d = pick(v, `d_${m}`), bf = pick(v, `bf_${m}`), tf = pick(v, `tf_${m}`), tw = pick(v, `tw_${m}`);
  const hr = n(v.hr) ?? v.Deck_Type, tc = n(v.tc) ?? v.selected_deck_topping_thickness, add = v.Additional_Topping || 0;
  const beff = pick(v, `b_eff_${m}`), a = pick(v, `a_${m}`) ?? pick(v, `a_3_${m}`);
  const Y1 = pick(v, `Y1_${m}`) ?? 0, Y2 = pick(v, `Y2_${m}`);
  const label = pickStr(v, `case_label_${m}`) || '';
  const Fy = v.Fy, fc = v.f_prime_c;
  const phiMn = pick(v, `Phi_Mn_${m}`), Mu = pick(v, `M_FL_${m}`), SQn = pick(v, `Sigma_Qn_${m}`);
  const Cc = { 'Case 3a': pick(v, `Cc_3_${m}`), 'Case 3b': pick(v, `Cc_3_${m}`), 'Case 2a': pick(v, `Cc_2a_${m}`), 'Case 2b': pick(v, `Cc_2b_${m}`) }[label]
    ?? (label === 'Case 1' && n(pick(v, `A_${m}`)) ? pick(v, `A_${m}`) * Fy : null);
  if (![d, bf, tf, tw, hr, tc].every(Number.isFinite)) return '';
  const slabT = hr + tc + add;
  const W = 640, H = 340, top = 62, k = (H - top - 50) / (slabT + d);
  const yS = top, ySteel = top + slabT * k, yBot = ySteel + d * k;   // slab top, top of steel, bottom of steel
  const cx = 150, bfx = Math.max(bf * k, 16), twx = Math.max(tw * k, 3), tfx = Math.max(tf * k, 2);
  const slabW = 250;                                                   // b_eff drawn with breaks (not to scale)
  let b = ARROW;
  b += T(14, 18, `<tspan font-weight="700">${esc(title)}</tspan>  <tspan fill="${COL.muted}">${esc(label)}${label.startsWith('Case 3') ? ' (partial composite)' : label ? ' (full composite)' : ''}</tspan>`, { size: 11 });
  // slab: topping, deck ribs, compression block
  b += R(cx - slabW / 2, yS, slabW, (tc + add) * k, { fill: COL.conc, stroke: COL.concDark });
  const ribTop = yS + (tc + add) * k, pitch = 38;
  for (let x = cx - slabW / 2; x < cx + slabW / 2 - 6; x += pitch) {
    b += `<path d="M${(x + 6).toFixed(1)} ${ribTop.toFixed(1)} L${(x + 10).toFixed(1)} ${ySteel.toFixed(1)} L${(x + 22).toFixed(1)} ${ySteel.toFixed(1)} L${(x + 26).toFixed(1)} ${ribTop.toFixed(1)} Z" fill="${COL.conc}" stroke="${COL.concDark}"/>`;
  }
  b += L(cx - slabW / 2, ySteel, cx + slabW / 2, ySteel, { stroke: COL.steel, w: 1.2 });            // deck
  b += `<path d="M${cx - slabW / 2 - 4} ${yS - 4} l8 6 -8 6 8 6" fill="none" stroke="${COL.muted}"/><path d="M${cx + slabW / 2 + 4} ${yS - 4} l-8 6 8 6 -8 6" fill="none" stroke="${COL.muted}"/>`;
  if (Number.isFinite(a) && a > 0) b += R(cx - slabW / 2, yS, slabW, Math.min(a, tc + add) * k, { fill: COL.comp, op: 0.45 });
  b += dimH(cx - slabW / 2, cx + slabW / 2, yS - 12, `b<tspan baseline-shift="sub" font-size="8">eff</tspan> = ${fmt(beff, 1)} in (not to scale)`);
  // W-shape
  b += R(cx - bfx / 2, ySteel, bfx, tfx, { fill: COL.steelFill, stroke: COL.steel }) + R(cx - twx / 2, ySteel + tfx, twx, d * k - 2 * tfx, { fill: COL.steelFill, stroke: COL.steel }) +
    R(cx - bfx / 2, yBot - tfx, bfx, tfx, { fill: COL.steelFill, stroke: COL.steel });
  // compression in the steel above the PNA (shaded on the section)
  if (Y1 > 0) {
    const yP = ySteel + Y1 * k;
    const fl = Math.min(Y1, tf) * k;
    b += R(cx - bfx / 2, ySteel, bfx, fl, { fill: COL.comp, op: 0.4 });
    if (Y1 > tf) b += R(cx - twx / 2, ySteel + tfx, twx, yP - ySteel - tfx, { fill: COL.comp, op: 0.4 });
  }
  // dimensions on the section
  b += dimV(cx - slabW / 2 - 18, yS, ySteel, `${fmt(slabT, 2)} in`, { side: 'left' });
  b += dimV(cx - bfx / 2 - 18, ySteel, yBot, `d = ${fmt(d, 2)} in`, { side: 'left' });
  b += T(cx, yBot + 16, `b<tspan baseline-shift="sub" font-size="8">f</tspan> ${fmt(bf, 2)} · t<tspan baseline-shift="sub" font-size="8">f</tspan> ${fmt(tf, 3)} · t<tspan baseline-shift="sub" font-size="8">w</tspan> ${fmt(tw, 3)} in`, { size: 9.5, anchor: 'middle', fill: COL.muted });
  // PNA across both diagrams
  const yPNA = Y1 > 0 ? ySteel + Y1 * k : null;
  // stress diagram: compression to the left of the axis, tension to the right
  const ax = 455, sw = 58;
  b += L(ax, yS - 4, ax, yBot + 4, { stroke: COL.text });
  if (Number.isFinite(a) && a > 0) {
    b += R(ax - sw, yS, sw, Math.min(a, tc + add) * k, { fill: COL.comp, op: 0.5, stroke: COL.comp });
    b += T(ax - sw / 2, yS - 6, `0.85 f′<tspan baseline-shift="sub" font-size="8">c</tspan> = ${fmt(0.85 * fc, 2)} ksi`, { size: 9.5, anchor: 'middle', fill: COL.comp });
  }
  if (yPNA) b += R(ax - sw, ySteel, sw, yPNA - ySteel, { fill: COL.comp, op: 0.3, stroke: COL.comp });
  b += R(ax, yPNA ?? ySteel, sw, yBot - (yPNA ?? ySteel), { fill: COL.ten, op: 0.35, stroke: COL.ten });
  b += T(ax + sw + 4, yBot - 4, `F<tspan baseline-shift="sub" font-size="8">y</tspan> = ${fmt(Fy, 0)} ksi`, { size: 9.5, fill: COL.ten });
  if (yPNA) b += T(ax - sw - 4, yPNA - 4, `F<tspan baseline-shift="sub" font-size="8">y</tspan>`, { size: 9.5, anchor: 'end', fill: COL.comp });
  if (yPNA) {
    b += L(cx - slabW / 2, yPNA, ax + sw + 50, yPNA, { stroke: COL.pna, w: 1.2, dash: '5 3' });
    b += T(cx - slabW / 2, yPNA - 4, 'PNA', { size: 10, fill: COL.pna, weight: 700 });
    b += dimV(ax + sw + 22, ySteel, yPNA, `Y<tspan baseline-shift="sub" font-size="8">1</tspan> = ${fmt(Y1, 3)} in`);
  } else b += T(ax + sw + 6, ySteel - 4, 'PNA in the slab (steel all in tension)', { size: 9.5, fill: COL.pna });
  // concrete force at the solver's lever arm Y2 (from the top of the steel)
  if (Number.isFinite(Y2)) {
    const yC = ySteel - Y2 * k;
    b += arrow(ax - 4, yC, ax - sw - 70, yC, COL.comp, 1.8);
    b += T(ax - sw - 74, yC + 3.5, `C<tspan baseline-shift="sub" font-size="8">c</tspan>${Number.isFinite(Cc) ? ` = ${fmt(Cc, 1)} kips` : ''}`, { size: 10, anchor: 'end', fill: COL.comp, weight: 700 });
    b += dimV(ax + sw + 22, yC, ySteel, `Y<tspan baseline-shift="sub" font-size="8">2</tspan> = ${fmt(Y2, 3)} in`);
  }
  // result
  const yR = H - 14;
  let res = '';
  if (Number.isFinite(SQn)) res += `ΣQ<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(SQn, 1)} kips · `;
  if (Number.isFinite(a)) res += `a = ${fmt(a, 3)} in · `;
  if (Number.isFinite(phiMn)) res += `φM<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(phiMn, 1)} kip·ft`;
  if (Number.isFinite(phiMn) && Number.isFinite(Mu)) res += ` vs M<tspan baseline-shift="sub" font-size="8">u</tspan> = ${fmt(Mu, 1)} kip·ft (${fmt(100 * Mu / phiMn, 0)} %)`;
  b += T(14, yR, res, { size: 10.5, weight: 600 });
  return svg(W, H, b, `${title}: composite section and plastic stress distribution`);
}

// ---------------------------------------------------------------------------------------------------------------
// utilisation of every check with a demand / capacity ratio
export function utilisation(rows) {
  const items = rows.filter(r => Number.isFinite(r.ratio));
  if (!items.length) return '';
  const W = 640, rowH = 20, top = 22, H = top + items.length * rowH + 26, x0 = 290, wBar = W - x0 - 60, max = 1.2;
  const X = (r) => x0 + Math.min(r, max) / max * wBar;
  let b = '';
  b += T(x0, 14, '0', { size: 9.5, anchor: 'middle', fill: COL.muted }) + T(X(0.5), 14, '50 %', { size: 9.5, anchor: 'middle', fill: COL.muted }) + T(X(1), 14, '100 %', { size: 9.5, anchor: 'middle', fill: COL.text, weight: 700 });
  items.forEach((r, i) => {
    const y = top + i * rowH;
    const c = r.ratio > 1 ? COL.fail : r.ratio > 0.9 ? COL.warn : COL.pass;
    b += T(x0 - 8, y + 13, `<tspan fill="${COL.muted}">${esc(r.group)} · </tspan>${esc(r.label)}`, { size: 10, anchor: 'end' });
    b += R(x0, y + 4, wBar, 12, { fill: '#eef2f6' }) + R(x0, y + 4, X(r.ratio) - x0, 12, { fill: c });
    b += T(X(r.ratio) + 4, y + 14, `${fmt(r.ratio * 100, 0)} %`, { size: 9.5, fill: c, weight: 700 });
  });
  b += L(X(1), top - 2, X(1), top + items.length * rowH + 2, { stroke: COL.text, w: 1.2, dash: '4 3' });
  return svg(W, H, b, 'Utilisation of every check');
}

// ---------------------------------------------------------------------------------------------------------------
// DG 11 walking: a_p/g against frequency for this floor's effective weight and damping, with the design point
export function dg11Curve(v) {
  const W0 = v.W, beta = v.damping_ratio ?? v.DR, fn = v.fn, pa = v.peak_acceleration, lim = v.tolerance_limit;
  if (![W0, beta, fn, pa].every(Number.isFinite)) return '';
  const curve = (f) => 100 * 65 * Math.exp(-0.35 * f) / (beta * W0);      // DG 11 Eq. 4-1, the solver's ap_over_g line
  const W = 640, H = 300, pad = { l: 56, r: 20, t: 20, b: 40 };
  const fMax = Math.max(12, Math.ceil(fn * 1.5)), yMax = Math.max(lim * 2.2, pa * 1.3, curve(Math.max(2, fn * 0.55)));
  const X = (f) => pad.l + f / fMax * (W - pad.l - pad.r), Y = (y) => H - pad.b - Math.min(y, yMax) / yMax * (H - pad.t - pad.b);
  let b = '';
  for (let f = 0; f <= fMax; f += 2) b += L(X(f), Y(0), X(f), Y(yMax), { stroke: COL.line }) + T(X(f), H - pad.b + 14, `${f}`, { size: 9.5, anchor: 'middle', fill: COL.muted });
  const yStep = yMax > 2 ? 0.5 : yMax > 1 ? 0.25 : 0.1;
  for (let y = 0; y <= yMax + 1e-9; y += yStep) b += L(X(0), Y(y), X(fMax), Y(y), { stroke: COL.line }) + T(pad.l - 6, Y(y) + 3.5, fmt(y, 2), { size: 9.5, anchor: 'end', fill: COL.muted });
  b += R(X(0), Y(yMax), X(fMax) - X(0), Y(lim) - Y(yMax), { fill: COL.fail, op: 0.07 });
  b += L(X(0), Y(lim), X(fMax), Y(lim), { stroke: COL.fail, w: 1.3, dash: '6 4' }) + T(X(fMax) - 4, Y(lim) - 5, `limit a₀/g = ${fmt(lim, 2)} %g`, { size: 10, anchor: 'end', fill: COL.fail });
  let p = '';
  for (let i = 0; i <= 160; i++) { const f = 0.6 + (fMax - 0.6) * i / 160; p += `${i ? 'L' : 'M'}${X(f).toFixed(1)} ${Y(curve(f)).toFixed(1)} `; }
  b += `<path d="${p}" fill="none" stroke="${COL.comp}" stroke-width="2"/>`;
  b += L(X(fn), Y(0), X(fn), Y(pa), { stroke: COL.muted, dash: '3 3' });
  b += `<circle cx="${X(fn).toFixed(1)}" cy="${Y(pa).toFixed(1)}" r="5.5" fill="${pa <= lim ? COL.pass : COL.fail}" stroke="#fff" stroke-width="1.5"/>`;
  b += T(X(fn) + 9, Y(pa) + 18, `f<tspan baseline-shift="sub" font-size="8">n</tspan> = ${fmt(fn, 2)} Hz, a<tspan baseline-shift="sub" font-size="8">p</tspan>/g = ${fmt(pa, 3)} %g`, { size: 10.5, weight: 700 });
  b += T((pad.l + W - pad.r) / 2, H - 6, 'floor frequency f (Hz)', { size: 10, anchor: 'middle', fill: COL.muted });
  b += `<text transform="translate(14 ${(pad.t + H - pad.b) / 2}) rotate(-90)" font-size="10" text-anchor="middle" fill="${COL.muted}">a<tspan baseline-shift="sub" font-size="8">p</tspan>/g (%g)</text>`;
  b += T(pad.l + 8, pad.t + 12, `65 e<tspan baseline-shift="super" font-size="8">−0.35 f</tspan> / (β W): β = ${beta}, W = ${fmt(W0 / 1000, 1)} kips`, { size: 10, fill: COL.comp });
  return svg(W, H, b, 'DG 11 peak acceleration against frequency');
}

// ---------------------------------------------------------------------------------------------------------------
// mitigation trade-off: every design state, peak acceleration against embodied carbon
export function tradeoff(points, lim) {
  const pts = points.filter(p => Number.isFinite(p.pa) && Number.isFinite(p.ec));
  if (!pts.length) return '';
  const W = 640, H = 300, pad = { l: 58, r: 24, t: 18, b: 40 };
  const xs = pts.map(p => p.pa), ys = pts.map(p => p.ec);
  const xMax = Math.max(lim * 1.4, ...xs) * 1.08, xMin = 0;
  const yLo = Math.min(...ys), yHi = Math.max(...ys), yr = Math.max(yHi - yLo, yHi * 0.1);
  const yMin = Math.max(0, yLo - yr * 0.15), yMax = yHi + yr * 0.15;
  const X = (x) => pad.l + (x - xMin) / (xMax - xMin) * (W - pad.l - pad.r), Y = (y) => H - pad.b - (y - yMin) / (yMax - yMin) * (H - pad.t - pad.b);
  let b = R(X(lim), Y(yMax), X(xMax) - X(lim), Y(yMin) - Y(yMax), { fill: COL.fail, op: 0.06 });
  b += L(X(lim), Y(yMin), X(lim), Y(yMax), { stroke: COL.fail, w: 1.3, dash: '6 4' }) + T(X(lim) + 4, Y(yMax) + 12, `limit ${lim} %g`, { size: 10, fill: COL.fail });
  for (let i = 0; i <= 4; i++) {
    const y = yMin + (yMax - yMin) * i / 4, x = xMax * i / 4;
    b += L(X(0), Y(y), X(xMax), Y(y), { stroke: COL.line }) + T(pad.l - 6, Y(y) + 3.5, fmt(y, 1), { size: 9.5, anchor: 'end', fill: COL.muted });
    b += T(X(x), H - pad.b + 14, fmt(x, 2), { size: 9.5, anchor: 'middle', fill: COL.muted });
  }
  for (const p of pts) {
    b += `<circle cx="${X(p.pa).toFixed(1)}" cy="${Y(p.ec).toFixed(1)}" r="${p.sel ? 7 : 5}" fill="${p.color}" stroke="${p.sel ? COL.text : '#fff'}" stroke-width="${p.sel ? 2 : 1.2}"/>`;
    b += T(X(p.pa) + 9, Y(p.ec) + 3.5, esc(p.label), { size: 9.5, weight: p.sel ? 700 : 400 });
  }
  b += T((pad.l + W - pad.r) / 2, H - 6, 'peak acceleration a_p/g (%g)', { size: 10, anchor: 'middle', fill: COL.muted });
  b += `<text transform="translate(14 ${(pad.t + H - pad.b) / 2}) rotate(-90)" font-size="10" text-anchor="middle" fill="${COL.muted}">embodied carbon (kg CO₂e/m²)</text>`;
  return svg(W, H, b, 'Mitigation trade-off');
}

export const ecM2 = (ecPerFt2) => ecPerFt2 * FT2_PER_M2;
export { fmtFixed };
