// Module 2: the published design space (40,344 designs) -- heatmap, 3D landscape,
// scatter, and the paper's figures. Everything here reads the packed copy of the
// release's data/imperial CSVs; nothing is recomputed except averages for display.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { $, $$, h, esc, store, debounce } from '../lib/dom.js';
import { loadDataset } from '../lib/data.js';
import { rgb, css as cmapCss, METHOD_COLORS, METHOD_LABELS, GRADIENT } from '../lib/colormap.js';
import { columnSplitters } from '../lib/splitters.js';
import { fmt, fmtFixed, ecFromDataset, ecUnit, getUnits, onUnits, LB_TO_KG, FT2_PER_M2 } from '../lib/units.js';

const LIMIT = 0.5;
const METRICS = {
  ipa: { label: 'Initial peak acceleration', unit: '%g', desc: 'DG 11 peak acceleration of the initial (strength- and deflection-sized) design.', pa: true },
  over: { label: 'Initial PA over the limit', unit: '%g', desc: 'max(a_p − 0.5 %g, 0) — the paper\'s Figure 7 (left).', pa: true },
  iec: { label: 'Initial embodied carbon', unit: 'ec', desc: 'Scaled EC of the initial design — Figure 7 (right) / 12 (left).' },
  bec: { label: 'Mitigated embodied carbon', unit: 'ec', desc: 'Scaled EC of the controlling (lowest-carbon passing) design — Figure 12 (right).' },
  dec: { label: 'Carbon cost of mitigation', unit: '%', desc: 'Increase from initial to controlling design.' },
  fn: { label: 'Fundamental frequency', unit: 'Hz', desc: 'Combined floor frequency f_n of the initial design.' },
  method: { label: 'Most efficient mitigation', unit: '', desc: 'Most frequent controlling method at each bay size — Figure 11.', cat: true },
  pass: { label: 'Share passing as built', unit: '%', desc: 'Percent of designs meeting 0.5 %g without mitigation.' },
};
const SCATTER_X = { area: 'Bay area', g: 'Girder span', i: 'Infill span', ratio: 'Aspect ratio (infill : girder)', ipa: 'Initial peak acceleration', fn: 'Fundamental frequency', iec: 'Initial EC', bec: 'Mitigated EC' };
const SCATTER_C = { area: 'Bay area', deck: 'Deck depth', pcc: 'Percent composite', conc: 'Concrete', method: 'Mitigation method', ipa: 'Initial peak accel.' };

const FIG_PRESETS = {
  1: { designer: true, note: 'The geometric variables are the Bay Designer\'s inputs; open it to vary them on a live 3D bay.' },
  2: { designer: 'calcs', note: 'Deck and slab sizing. In the Bay Designer, “All calculations → Framing layout, deck and slab” shows every value this flowchart produces, with the solver\'s code.' },
  3: { designer: 'limits', note: 'Member sizing and limit-state filtering. The Bay Designer\'s “Limit states” tab lists each check for the selected pair.' },
  4: { designer: 'chain', note: 'The AISC DG 11 vibration model. The Bay Designer\'s “Vibration (DG 11)” tab walks this chain with substituted numbers.' },
  5: { designer: true, note: 'The mitigation process. The Bay Designer\'s “Mitigation trade-off” chart plots every upsizing and topping step the solver took.' },
  6: { view: 'scatter', x: 'area', y: 'ipa', c: 'area', system: 'composite', note: 'Mid-sized bays (roughly 600–1,200 ft²) carry the highest average peak acceleration: they are the most structurally efficient, so the lightest and most lively.' },
  7: { view: 'heat', metric: 'over', system: 'composite', note: 'Blue bays meet or nearly meet 0.5 %g on average; gold and red bays exceed it two to three times.' },
  8: { view: 'scatter', x: 'fn', y: 'ipa', c: 'area', system: 'composite', note: 'Larger bays drop in frequency but gain mass faster, so peak acceleration falls despite the lower frequency.' },
  9: { view: 'scatter', x: 'area', y: 'ipa', c: 'deck', system: 'composite', note: 'Deeper decks add mass and stiffness; compare the three averages.' },
  10: { view: 'scatter', x: 'area', y: 'ipa', c: 'pcc', system: 'composite', note: 'More composite action lowers carbon and raises peak acceleration slightly; non-composite designs (switch system) sit far lower in acceleration and higher in carbon.' },
  11: { view: 'heat', metric: 'method', system: 'composite', note: 'Steel upsizing controls almost everywhere; green bays need no mitigation on average.' },
  12: { view: 'heat', metric: 'bec', system: 'composite', note: 'Initial carbon is lowest for square-ish bays; after mitigation the optimum shifts to 1:1.25–1:1.75 bays with girders spanning the long way. Toggle the metric between initial and mitigated EC.' },
  13: { view: 'heat', metric: 'bec', system: 'noncomposite', note: 'Non-composite designs barely change after mitigation: most already meet the limit.' },
  14: { view: 'heat', metric: 'dec', system: 'composite', note: 'The carbon cost of mitigation across the design space.' },
  15: { none: true, note: 'The damping study is a separate 10,000-run Latin-hypercube set (data/*/damping_study_*). In the Bay Designer, occupancy changes the damping ratio the solver uses.' },
};

export function createExplorer(root, ctx) {
  const F = { system: 'composite', conc: 'all', deck: 'all', pcc: 'all', metric: 'ipa', view: 'heat', x: 'area', y: 'ipa', c: 'area', guides: true, hscale: 'fit', ...store.get('explore', {}) };
  let ds = {}, sel = null, figs = null;
  let landscape = null;

  root.innerHTML = `<div class="explore">
    <aside class="x-left" id="xIn"></aside>
    <div class="x-center">
      <div class="x-head">
        <div class="seg" id="xView"><button data-v="heat">Heatmap</button><button data-v="land">3D landscape</button><button data-v="scatter">Scatter</button><button data-v="figs">Paper figures</button></div>
        <h3 id="xTitle" style="margin-left:6px"></h3><span class="spacer"></span><span class="small muted" id="xCount"></span>
        <button class="btn btn-sm side-toggle" id="xSide" title="Show or hide the details panel">Details ◂</button>
      </div>
      <div class="x-stage" id="xStage"></div>
      <div class="x-foot" id="xFoot"></div>
    </div>
    <aside class="x-right" id="xOut"></aside>
  </div>
  <div class="lightbox" id="lb" hidden></div>`;
  const stage = $('#xStage', root);
  columnSplitters(root.querySelector('.explore'), 'cols.explore');
  const tip = h('div', { class: 'tip', hidden: true });

  async function getDs(sys) { if (!ds[sys]) ds[sys] = await loadDataset(sys); return ds[sys]; }

  // ------------------------------------------------------------------ filters
  function seg(id, opts, cur) {
    return `<div class="seg seg-block seg-sm" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  }
  function renderInputs() {
    const isFig = F.view === 'figs';
    $('#xIn', root).innerHTML = isFig ? `<div class="panel-title">The paper's figures</div>
      <p class="small muted">Figures 1–15 of the manuscript. Click one to zoom and read what it shows; results figures open the matching interactive view.</p>
      <div class="metric-list">${(figs?.figures || []).map(f => `<button data-fig="${f.num}"><b>Figure ${f.num}</b>${esc(f.caption.slice(0, 70))}${f.caption.length > 70 ? '…' : ''}</button>`).join('')}</div>` : `
      <div class="panel-title">Designs</div>
      <div class="field">${seg('fSys', [['composite', 'Composite'], ['noncomposite', 'Non-composite']], F.system)}</div>
      <div class="field"><div class="field-label"><span>Concrete</span></div>${seg('fConc', [['all', 'Both'], [0, 'NWC'], [1, 'LWC']], F.conc)}</div>
      <div class="field"><div class="field-label"><span>Deck depth</span></div>${seg('fDeck', [['all', 'All'], [1.5, '1.5"'], [2, '2"'], [3, '3"']], F.deck)}</div>
      ${F.system === 'composite' ? `<div class="field"><div class="field-label"><span>Composite connection</span></div>${seg('fPcc', [['all', 'All'], [25, '25%'], [50, '50%'], [75, '75%']], F.pcc)}</div>` : ''}
      <div class="small muted" style="margin:-4px 0 12px">“All / Both” averages the matching designs, as the paper's maps do.</div>
      ${F.view === 'scatter' ? `
        <div class="panel-title">Axes</div>
        <div class="field"><div class="field-label"><span>x</span></div><select id="sx">${Object.entries(SCATTER_X).map(([k, t]) => `<option value="${k}"${F.x === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><div class="field-label"><span>y</span></div><select id="sy">${Object.entries(SCATTER_X).map(([k, t]) => `<option value="${k}"${F.y === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><div class="field-label"><span>Colour</span></div><select id="sc">${Object.entries(SCATTER_C).map(([k, t]) => `<option value="${k}"${F.c === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>` : `
        <div class="panel-title">${F.view === 'land' ? 'Height &amp; colour' : 'Colour by'}</div>
        <div class="metric-list" id="fMetric">${Object.entries(METRICS).filter(([k]) => F.view !== 'land' || !METRICS[k].cat).map(([k, m]) => `<button data-v="${k}" class="${F.metric === k ? 'on' : ''}"><b>${m.label}</b>${esc(m.desc)}</button>`).join('')}</div>
        ${F.view === 'heat' ? `<label class="chk small" style="margin-top:12px"><input type="checkbox" id="fGuides" ${F.guides ? 'checked' : ''}> Typical bay-area guides (750 / 1,000 / 1,250 ft²)</label>` : ''}`}`;
    const R = $('#xIn', root);
    const bind = (id, key, num) => $$(`#${id} button`, R).forEach(b => b.onclick = () => { F[key] = b.dataset.v === 'all' ? 'all' : (num ? +b.dataset.v : b.dataset.v); if (key === 'system' && F.system === 'noncomposite') F.pcc = 'all'; save(); renderAll(); });
    bind('fSys', 'system'); bind('fConc', 'conc', true); bind('fDeck', 'deck', true); bind('fPcc', 'pcc', true);
    $$('#fMetric button', R).forEach(b => b.onclick = () => { F.metric = b.dataset.v; save(); renderAll(); });
    for (const k of ['x', 'y', 'c']) { const s = $(`#s${k}`, R); if (s) s.onchange = () => { F[k] = s.value; save(); renderAll(); }; }
    const g = $('#fGuides', R); if (g) g.onchange = () => { F.guides = g.checked; save(); renderStage(); };
    $$('[data-fig]', R).forEach(b => b.onclick = () => openFig(+b.dataset.fig));
  }
  function save() { store.set('explore', { ...F }); }

  // ------------------------------------------------------------------ data helpers
  function rows(d) {
    const out = [];
    const conc = d.raw('conc'), deck = d.raw('deck'), pcc = d.raw('pcc');
    for (let r = 0; r < d.n; r++) {
      if (F.conc !== 'all' && conc[r] !== F.conc) continue;
      if (F.deck !== 'all' && deck[r] !== Math.round(F.deck * 2)) continue;
      if (d.system === 'composite' && F.pcc !== 'all' && pcc[r] !== F.pcc) continue;
      out.push(r);
    }
    return out;
  }
  function metric(d, r, k) {
    const ipa = d.get('initial.pa', r);
    switch (k) {
      case 'ipa': return ipa;
      case 'over': return Math.max(ipa - LIMIT, 0);
      case 'iec': return ecFromDataset(d.get('initial.ec', r)).v;
      case 'bec': { const m = d.get('method', r); const v = d.get('best.ec', r); return m === 5 || !(v > 0) ? NaN : ecFromDataset(v).v; }
      case 'dec': { const m = d.get('method', r); const b = d.get('best.ec', r), i = d.get('initial.ec', r); return m === 5 || !(b > 0) ? NaN : (b / i - 1) * 100; }
      case 'fn': return d.get('initial.fn', r);
      case 'method': return d.get('method', r);
      case 'pass': return ipa <= LIMIT ? 100 : 0;
      case 'area': return d.get('g', r) * d.get('i', r);
      case 'g': return d.get('g', r);
      case 'i': return d.get('i', r);
      case 'ratio': return d.get('i', r) / d.get('g', r);
      case 'deck': return d.get('deck', r);
      case 'pcc': return d.get('pcc', r);
      case 'conc': return d.get('conc', r);
    }
    return NaN;
  }
  function unitOf(k) { const u = METRICS[k]?.unit ?? ''; return u === 'ec' ? ecUnit() : u; }
  function axisLabel(k) { return `${SCATTER_X[k] || METRICS[k]?.label || k}${({ area: ' (ft²)', g: ' (ft)', i: ' (ft)', ipa: ' (%g)', fn: ' (Hz)', iec: ` (${ecUnit()})`, bec: ` (${ecUnit()})` })[k] || ''}`; }

  // 41 x 41 grid of aggregated values
  function grid(d, rs, k) {
    const cells = new Map();
    for (const r of rs) {
      const key = d.raw('g')[r] * 100 + d.raw('i')[r];
      let c = cells.get(key);
      if (!c) { c = { g: d.raw('g')[r], i: d.raw('i')[r], rows: [], sum: 0, n: 0, votes: {} }; cells.set(key, c); }
      c.rows.push(r);
      const v = metric(d, r, k);
      if (METRICS[k]?.cat) { if (Number.isFinite(v)) c.votes[v] = (c.votes[v] || 0) + 1; }
      else if (Number.isFinite(v)) { c.sum += v; c.n++; }
    }
    for (const c of cells.values()) {
      if (METRICS[k]?.cat) { const e = Object.entries(c.votes).sort((a, b) => b[1] - a[1]); c.v = e.length ? +e[0][0] : NaN; c.share = e.length ? e[0][1] / c.rows.length : 0; }
      else c.v = c.n ? c.sum / c.n : NaN;
    }
    return cells;
  }

  // ------------------------------------------------------------------ rendering
  async function renderAll() {
    renderInputs();
    $$('#xView button', root).forEach(b => b.classList.toggle('on', b.dataset.v === F.view));
    await renderStage();
  }

  async function renderStage() {
    if (F.view !== 'land' && landscape) { landscape.dispose(); landscape = null; }
    stage.innerHTML = '';
    stage.append(tip);
    if (F.view === 'figs') return renderGallery();
    stage.insertAdjacentHTML('beforeend', '<div class="vp-overlay"><div class="solving"><span class="spinner"></span>Loading the published designs…</div></div>');
    let d;
    try { d = await getDs(F.system); } catch (e) { stage.innerHTML = `<div class="about"><p>Could not load the dataset (${esc(e.message)}).</p></div>`; return; }
    stage.innerHTML = '';
    stage.append(tip);
    const rs = rows(d);
    $('#xCount', root).textContent = `${rs.length.toLocaleString()} of ${d.n.toLocaleString()} published ${F.system === 'composite' ? 'composite' : 'non-composite'} designs`;
    if (F.view === 'heat') heatmap(d, rs);
    else if (F.view === 'land') land(d, rs);
    else scatterView(d, rs);
    renderSelection(d);
  }

  // ---------------------------------------------------------------- heatmap
  function heatmap(d, rs) {
    const k = F.metric, M = METRICS[k];
    $('#xTitle', root).textContent = `${M.label}${M.cat ? '' : ` (${unitOf(k)})`}`;
    const cells = grid(d, rs, k);
    const vals = [...cells.values()].map(c => c.v).filter(Number.isFinite);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (k === 'ipa' || k === 'over' || k === 'pass') lo = 0;
    const cv = h('canvas');
    stage.append(cv);
    const W = stage.clientWidth, H = stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const pad = { l: 58, r: 20, t: 18, b: 60 };
    const size = Math.min((W - pad.l - pad.r), (H - pad.t - pad.b));
    const cs = size / 41;
    const ox = pad.l + (W - pad.l - pad.r - size) / 2, oy = pad.t;
    const X = (gs) => ox + (gs - 10) * cs, Y = (is) => oy + (50 - is) * cs;
    const dark = document.documentElement.dataset.theme !== 'light';
    g.fillStyle = dark ? '#0f151c' : '#eef2f6';
    g.fillRect(ox, oy, size, size);
    for (const c of cells.values()) {
      if (!Number.isFinite(c.v)) continue;
      g.fillStyle = M.cat ? (METHOD_COLORS[c.v] || '#555') : cmapCss((c.v - lo) / (hi - lo || 1));
      g.fillRect(X(c.g) + 0.5, Y(c.i) + 0.5, cs - 1, cs - 1);
      if (M.cat && c.share < 0.999) { g.fillStyle = 'rgba(0,0,0,' + (0.35 * (1 - c.share)) + ')'; g.fillRect(X(c.g) + 0.5, Y(c.i) + 0.5, cs - 1, cs - 1); }
    }
    // contour of the 0.5 %g limit on the average initial PA (marching squares on cell centres)
    if (k === 'ipa' || k === 'over') {
      const pa = grid(d, rs, 'ipa');
      const val = (gs, is) => pa.get(gs * 100 + is)?.v;
      g.strokeStyle = dark ? '#ffffff' : '#14202b'; g.lineWidth = 2; g.setLineDash([]);
      g.beginPath();
      for (let gs = 10; gs < 50; gs++) for (let is = 10; is < 50; is++) {
        const a = val(gs, is), b = val(gs + 1, is), c2 = val(gs + 1, is + 1), e = val(gs, is + 1);
        if (![a, b, c2, e].every(Number.isFinite)) continue;
        const pts = [];
        const edge = (v1, v2, p1, p2) => { if ((v1 - LIMIT) * (v2 - LIMIT) < 0) { const t = (LIMIT - v1) / (v2 - v1); pts.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]); } };
        const P = (x, y) => [X(x) + cs / 2, Y(y) + cs / 2];
        edge(a, b, P(gs, is), P(gs + 1, is)); edge(b, c2, P(gs + 1, is), P(gs + 1, is + 1)); edge(c2, e, P(gs + 1, is + 1), P(gs, is + 1)); edge(e, a, P(gs, is + 1), P(gs, is));
        if (pts.length >= 2) { g.moveTo(...pts[0]); g.lineTo(...pts[1]); if (pts.length === 4) { g.moveTo(...pts[2]); g.lineTo(...pts[3]); } }
      }
      g.stroke();
    }
    // typical bay-area guides g * i = A
    if (F.guides) {
      g.setLineDash([5, 4]); g.lineWidth = 1.3; g.strokeStyle = dark ? 'rgba(255,255,255,.7)' : 'rgba(20,32,43,.7)';
      g.font = '11px system-ui'; g.fillStyle = g.strokeStyle;
      for (const A of [750, 1000, 1250]) {
        g.beginPath();
        let started = false;
        for (let gs = 10; gs <= 50; gs += 0.25) {
          const is = A / gs;
          if (is < 10 || is > 50) { started = false; continue; }
          const x = X(gs) + cs / 2, y = Y(is) + cs / 2;
          if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
        }
        g.stroke();
        const gl = Math.min(50, A / 14);
        g.fillText(`${A} ft²`, X(gl) + cs, Y(A / gl) - 2);
      }
      g.setLineDash([]);
    }
    // axes
    g.fillStyle = dark ? '#b4c0cc' : '#3a4a5a'; g.font = '11px system-ui'; g.textAlign = 'center';
    for (let v = 10; v <= 50; v += 5) { g.fillText(v, X(v) + cs / 2, oy + size + 16); }
    g.textAlign = 'right';
    for (let v = 10; v <= 50; v += 5) { g.fillText(v, ox - 8, Y(v) + cs / 2 + 4); }
    g.textAlign = 'center'; g.font = '12px system-ui';
    g.fillText('Girder span (ft)', ox + size / 2, oy + size + 36);
    g.save(); g.translate(ox - 42, oy + size / 2); g.rotate(-Math.PI / 2); g.fillText('Infill span (ft)', 0, 0); g.restore();
    if (sel) { g.strokeStyle = dark ? '#fff' : '#000'; g.lineWidth = 2.5; g.strokeRect(X(sel.g) - 1, Y(sel.i) - 1, cs + 2, cs + 2); }

    legend(lo, hi, k);
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      const gs = Math.floor((e.clientX - r.left - ox) / cs) + 10, is = 50 - Math.floor((e.clientY - r.top - oy) / cs);
      return gs >= 10 && gs <= 50 && is >= 10 && is <= 50 ? cells.get(gs * 100 + is) : null;
    };
    cv.onmousemove = (e) => {
      const c = at(e);
      if (!c) { tip.hidden = true; return; }
      tip.hidden = false;
      const r = stage.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 200) + 'px';
      tip.style.top = (e.clientY - r.top + 14) + 'px';
      tip.innerHTML = `<b>L<sub>g</sub> ${c.g} × L<sub>j</sub> ${c.i} ft</b> · ${c.g * c.i} ft² <div class="t-row"><span>${esc(M.label)}</span><b>${M.cat ? esc(METHOD_LABELS[c.v] || '—') + ` (${fmt(c.share * 100, 0)}%)` : fmt(c.v, 3) + ' ' + unitOf(k)}</b></div><div class="t-row"><span>designs</span><b>${c.rows.length}</b></div>`;
    };
    cv.onmouseleave = () => { tip.hidden = true; };
    cv.onclick = (e) => { const c = at(e); if (c) { sel = { g: c.g, i: c.i }; renderStage(); } };
  }

  function legend(lo, hi, k) {
    const M = METRICS[k];
    const foot = $('#xFoot', root);
    if (M?.cat) {
      const present = [1, 6, 4, 5];
      foot.innerHTML = present.map(m => `<span class="row"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${METHOD_COLORS[m]}"></i>${METHOD_LABELS[m]}</span>`).join('') + '<span class="tiny">darker = less consistent across the averaged designs</span>';
    } else {
      foot.innerHTML = `<span>${fmt(lo, 3)}</span><div style="width:260px;height:10px;border-radius:3px;background:${GRADIENT};position:relative">${(k === 'ipa') && hi > LIMIT ? `<div style="position:absolute;left:${(LIMIT - lo) / (hi - lo) * 100}%;top:-4px;bottom:-4px;width:2px;background:var(--text)"></div>` : ''}</div><span>${fmt(hi, 3)} ${unitOf(k)}</span>${k === 'ipa' || k === 'over' ? '<span>— solid line: average reaches 0.5 %g</span>' : ''}<span class="spacer"></span><span>Click a bay size for its designs</span>`;
    }
  }

  // ---------------------------------------------------------------- 3D landscape
  function land(d, rs) {
    const cat = F.metric === 'method';
    const k = cat ? 'ipa' : F.metric;
    const M = METRICS[k];
    const cells = grid(d, rs, k), pa = grid(d, rs, 'ipa'), meth = cat ? grid(d, rs, 'method') : null;
    const vals = [...cells.values()].map(c => c.v).filter(Number.isFinite);
    // height scale: Fit stretches the bars over this slice's range; From 0 keeps heights proportional
    const zero = F.hscale === 'zero';
    const lo = zero ? Math.min(0, ...vals) : Math.min(...vals), hi = Math.max(...vals);
    const u = unitOf(k);
    $('#xTitle', root).innerHTML = cat
      ? `Height: average initial peak acceleration · colour: most efficient mitigation`
      : `Height and colour: ${esc(M.label)}${u ? ` (${esc(u)})` : ''}`;
    const colorOf = cat
      ? (c) => METHOD_COLORS[meth.get(c.g * 100 + c.i)?.v] || '#555'
      : (c) => cmapCss((c.v - lo) / (hi - lo || 1));
    landscape?.dispose();
    landscape = makeLandscape(stage, cells, { lo, hi, k, colorOf, top: `${fmt(hi, 3)} ${u}`.trim(), bottom: `${fmt(lo, 3)} ${u}`.trim() }, (c, e) => {
      if (!c) { tip.hidden = true; return; }
      const r = stage.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 200) + 'px';
      tip.style.top = (e.clientY - r.top + 14) + 'px';
      const m = cat ? meth.get(c.g * 100 + c.i)?.v : null;
      tip.innerHTML = `<b>L<sub>g</sub> ${c.g} × L<sub>j</sub> ${c.i} ft</b><div class="t-row"><span>${esc(M.label)}</span><b>${fmt(c.v, 3)} ${u}</b></div>`
        + (cat ? `<div class="t-row"><span>most efficient mitigation</span><b>${esc(METHOD_LABELS[m] || '—')}</b></div>`
          : k === 'ipa' ? '' : `<div class="t-row"><span>avg initial PA</span><b>${fmt(pa.get(c.g * 100 + c.i)?.v, 3)} %g</b></div>`);
    }, (c) => { sel = { g: c.g, i: c.i }; renderSelection(d); });
    const present = cat ? [1, 6, 4, 5].filter(m => [...meth.values()].some(c => c.v === m)) : [];
    $('#xFoot', root).innerHTML = (cat
      ? present.map(m => `<span class="row"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${METHOD_COLORS[m]}"></i>${METHOD_LABELS[m]}</span>`).join('')
      : `<span>${fmt(lo, 3)}</span><div style="width:200px;height:10px;border-radius:3px;background:${GRADIENT}"></div><span>${fmt(hi, 3)} ${u}</span>`)
      + `<span class="seg" id="hScale" title="Bar height: fitted to this slice's range, or measured from zero"><button data-v="fit" class="${zero ? '' : 'on'}">Fit</button><button data-v="zero" class="${zero ? 'on' : ''}">From 0</button></span>`
      + `<span>height ${zero ? 'from 0' : `${fmt(lo, 3)} to ${fmt(hi, 3)}`}${k === 'ipa' && LIMIT >= lo && LIMIT <= hi ? ' · glass plane: 0.5 %g limit' : ''}</span><span class="spacer"></span><span>Drag to orbit · click a bay</span>`;
    root.querySelectorAll('#hScale button').forEach(b => b.onclick = () => { F.hscale = b.dataset.v; save(); renderAll(); });
  }

  // ---------------------------------------------------------------- scatter
  function scatterView(d, rs) {
    $('#xTitle', root).textContent = `${SCATTER_X[F.y]} vs ${SCATTER_X[F.x]}`;
    const cv = h('canvas');
    stage.append(cv);
    const W = stage.clientWidth, H = stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const pts = [];
    for (const r of rs) {
      const x = metric(d, r, F.x), y = metric(d, r, F.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || (F.y === 'bec' && y === 0)) continue;
      pts.push({ r, x, y, c: metric(d, r, F.c === 'ipa' ? 'ipa' : F.c) });
    }
    if (!pts.length) return;
    const pad = { l: 62, r: 20, t: 16, b: 46 };
    let x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
    if (['ipa'].includes(F.y)) y0 = 0;
    const xr = x1 - x0 || 1, yr = y1 - y0 || 1;
    x0 -= xr * 0.02; x1 += xr * 0.02; y1 += yr * 0.04;
    const PW = W - pad.l - pad.r, PH = H - pad.t - pad.b;
    const X = v => pad.l + (v - x0) / (x1 - x0) * PW, Y = v => pad.t + (1 - (v - y0) / (y1 - y0)) * PH;
    const dark = document.documentElement.dataset.theme !== 'light';
    // grid
    g.strokeStyle = dark ? '#223040' : '#dbe2ea'; g.lineWidth = 1; g.fillStyle = dark ? '#b4c0cc' : '#3a4a5a'; g.font = '11px system-ui';
    const ticks = (a, b, n) => { const s = Math.pow(10, Math.floor(Math.log10((b - a) / n))); const st = [1, 2, 2.5, 5, 10].map(m => m * s).find(q => (b - a) / q <= n) || s * 10; const t = []; for (let v = Math.ceil(a / st) * st; v <= b; v += st) t.push(+v.toFixed(8)); return t; };
    g.textAlign = 'right';
    for (const t of ticks(y0, y1, 6)) { g.beginPath(); g.moveTo(pad.l, Y(t)); g.lineTo(pad.l + PW, Y(t)); g.stroke(); g.fillText(fmt(t, 2), pad.l - 6, Y(t) + 4); }
    g.textAlign = 'center';
    for (const t of ticks(x0, x1, 8)) { g.beginPath(); g.moveTo(X(t), pad.t); g.lineTo(X(t), pad.t + PH); g.stroke(); g.fillText(fmt(t, 2), X(t), pad.t + PH + 16); }
    g.font = '12px system-ui';
    g.fillText(axisLabel(F.x), pad.l + PW / 2, H - 8);
    g.save(); g.translate(14, pad.t + PH / 2); g.rotate(-Math.PI / 2); g.fillText(axisLabel(F.y), 0, 0); g.restore();
    // colour
    const cvals = pts.map(p => p.c).filter(Number.isFinite);
    const clo = Math.min(...cvals), chi = Math.max(...cvals);
    const catColor = { deck: { 1.5: '#4178BE', 2: '#A3B376', 3: '#E57373' }, pcc: { 25: '#4178BE', 50: '#A3B376', 75: '#E57373', 0: '#FCAE2E' }, conc: { 0: '#4178BE', 1: '#FCAE2E' } };
    const colOf = (p) => F.c === 'method' ? METHOD_COLORS[p.c] : catColor[F.c] ? catColor[F.c][p.c] : cmapCss((p.c - clo) / (chi - clo || 1));
    g.globalAlpha = Math.max(0.18, Math.min(0.8, 3000 / pts.length));
    for (const p of pts) { g.fillStyle = colOf(p); g.fillRect(X(p.x) - 1.4, Y(p.y) - 1.4, 2.8, 2.8); }
    g.globalAlpha = 1;
    // piecewise averages per colour group (or overall)
    const groups = catColor[F.c] || F.c === 'method' ? [...new Set(pts.map(p => p.c))] : [null];
    for (const gv of groups) {
      const sub = gv === null ? pts : pts.filter(p => p.c === gv);
      const nb = 36, bins = Array.from({ length: nb }, () => [0, 0]);
      for (const p of sub) { const b = Math.min(nb - 1, Math.floor((p.x - x0) / (x1 - x0) * nb)); bins[b][0] += p.y; bins[b][1]++; }
      g.strokeStyle = gv === null ? (dark ? '#ffffff' : '#14202b') : (F.c === 'method' ? METHOD_COLORS[gv] : catColor[F.c][gv]);
      g.lineWidth = gv === null ? 2.5 : 2.2;
      g.beginPath();
      let first = true;
      bins.forEach((b, j) => { if (b[1] < 3) return; const x = X(x0 + (j + 0.5) / nb * (x1 - x0)), y = Y(b[0] / b[1]); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); });
      if (gv !== null) { g.save(); g.strokeStyle = dark ? '#0a0e13' : '#fff'; g.lineWidth = 4.5; g.stroke(); g.restore(); }
      g.stroke();
    }
    if (F.y === 'ipa') { g.setLineDash([6, 4]); g.strokeStyle = dark ? '#fff' : '#000'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(pad.l, Y(LIMIT)); g.lineTo(pad.l + PW, Y(LIMIT)); g.stroke(); g.setLineDash([]); g.fillStyle = g.strokeStyle; g.textAlign = 'left'; g.fillText('0.5 %g', pad.l + 6, Y(LIMIT) - 5); }
    // legend
    const foot = $('#xFoot', root);
    if (F.c === 'method') foot.innerHTML = [1, 6, 4, 5].map(m => `<span class="row"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${METHOD_COLORS[m]}"></i>${METHOD_LABELS[m]}</span>`).join('');
    else if (catColor[F.c]) foot.innerHTML = Object.entries(catColor[F.c]).filter(([v]) => pts.some(p => String(p.c) === v)).map(([v, c]) => `<span class="row"><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${c}"></i>${F.c === 'deck' ? v + '" deck' : F.c === 'pcc' ? v + ' %' : +v ? 'LWC' : 'NWC'}</span>`).join('') + '<span>lines: piecewise averages</span>';
    else foot.innerHTML = `<span>${esc(SCATTER_C[F.c])} ${fmt(clo, 2)}</span><div style="width:220px;height:10px;border-radius:3px;background:${GRADIENT}"></div><span>${fmt(chi, 2)}</span><span>· white line: piecewise average</span>`;
    foot.innerHTML += `<span class="spacer"></span><span>${pts.length.toLocaleString()} designs · click a point</span>`;
    // hover / click nearest
    const near = (e) => {
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 64;
      for (const p of pts) { const dx = X(p.x) - mx, dy = Y(p.y) - my, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = p; } }
      return best;
    };
    cv.onmousemove = (e) => {
      const p = near(e);
      if (!p) { tip.hidden = true; return; }
      const r = stage.getBoundingClientRect();
      const inp = d.inputs(p.r);
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 210) + 'px';
      tip.style.top = (e.clientY - r.top + 14) + 'px';
      tip.innerHTML = `<b>L<sub>g</sub> ${inp.g} × L<sub>j</sub> ${inp.i} ft</b> · ${inp.conc ? 'LWC' : 'NWC'} · ${inp.deck}" deck${d.system === 'composite' ? ` · ${inp.pcc}%` : ''}
        <div class="t-row"><span>initial infill / girder</span><b>${esc(d.shape('initial.inf', p.r))} / ${esc(d.shape('initial.gir', p.r))}</b></div>
        <div class="t-row"><span>a_p</span><b>${fmt(d.get('initial.pa', p.r), 3)} %g</b></div><div class="t-row"><span>f_n</span><b>${fmt(d.get('initial.fn', p.r), 2)} Hz</b></div>`;
    };
    cv.onmouseleave = () => { tip.hidden = true; };
    cv.onclick = (e) => { const p = near(e); if (p) { const inp = d.inputs(p.r); sel = { g: inp.g, i: inp.i, row: p.r }; renderSelection(d); } };
  }

  // ---------------------------------------------------------------- selection panel
  function renderSelection(d) {
    const out = $('#xOut', root);
    if (sel && window.innerWidth <= 1100) root.querySelector('.explore').classList.add('show-side');
    if (F.view === 'figs') { out.innerHTML = '<div class="small muted" style="padding:6px">Pick a figure to enlarge it.</div>'; return; }
    if (!sel) {
      out.innerHTML = `<div class="card"><div class="card-h">The published design space</div><div class="card-b small">
        <p style="margin-top:0">${d.n.toLocaleString()} ${d.system === 'composite' ? 'composite' : 'non-composite'} residential bays from the paper: every girder and infill span from 10 to 50 ft in 1 ft steps, both concretes, three deck depths${d.system === 'composite' ? ' and 25 / 50 / 75 % composite' : ''}.</p>
        <p>Each design carries its initial members, every mitigation path and the controlling design, exactly as published.</p>
        <p class="muted">Click a bay size on the map (or a point on the scatter) to see its designs, then open any of them in the Bay Designer to run the solver live and inspect every calculation.</p></div></div>
        ${summaryCard(d)}`;
      return;
    }
    const rs = rows(d).filter(r => d.raw('g')[r] === sel.g && d.raw('i')[r] === sel.i);
    rs.sort((a, b) => d.get('initial.pa', b) - d.get('initial.pa', a));
    let html = `<div class="card fade-in"><div class="card-h">L<sub>g</sub> ${sel.g} × L<sub>j</sub> ${sel.i} ft bay <span class="sub">${sel.g * sel.i} ft² · ${rs.length} design${rs.length === 1 ? '' : 's'}</span></div><div class="card-b" style="padding:8px 10px">`;
    html += '<table class="calc"><thead><tr><th>Design</th><th class="right">a<sub>p</sub> (%g)</th><th class="right">EC init → best</th><th></th></tr></thead><tbody>';
    for (const r of rs) {
      const inp = d.inputs(r);
      const pa = d.get('initial.pa', r), m = d.get('method', r);
      const ie = ecFromDataset(d.get('initial.ec', r)), be = ecFromDataset(d.get('best.ec', r));
      html += `<tr${sel.row === r ? ' style="background:color-mix(in srgb,var(--accent) 14%,transparent)"' : ''}><td><b>${inp.conc ? 'LWC' : 'NWC'} · ${inp.deck}"${d.system === 'composite' ? ` · ${inp.pcc}%` : ''}</b><div class="tiny muted">infill <span class="mono">${esc(d.shape('initial.inf', r))}</span> · girder <span class="mono">${esc(d.shape('initial.gir', r))}</span></div>
        <div class="tiny" style="color:${METHOD_COLORS[m]}">${esc(METHOD_LABELS[m])}</div></td>
        <td class="v" style="color:${pa <= LIMIT ? 'var(--pass)' : 'var(--fail)'}">${fmtFixed(pa, 3)}</td>
        <td class="v">${fmtFixed(ie.v, 2)} → ${m === 5 ? '—' : fmtFixed(be.v, 2)}</td>
        <td><button class="btn btn-sm" data-open="${r}" title="Run this design through the solver in the Bay Designer">Open</button></td></tr>`;
    }
    html += `</tbody></table><div class="tiny muted" style="margin-top:6px">EC in ${ecUnit()}. “Open” runs the solver live on these inputs and checks it against this published row.</div></div></div>`;
    out.innerHTML = html + summaryCard(d);
    $$('[data-open]', out).forEach(b => b.onclick = () => {
      const r = +b.dataset.open, inp = d.inputs(r);
      ctx.openInDesigner({ system: d.system, g: inp.g, i: inp.i, conc: inp.conc, deck: inp.deck, pcc: inp.pcc || 50 });
    });
  }

  function summaryCard(d) {
    const rs = rows(d);
    if (!rs.length) return '';
    let pass = 0, m = { 1: 0, 4: 0, 5: 0, 6: 0 }, sumI = 0, sumB = 0, nB = 0;
    const pas = [];
    for (const r of rs) {
      const pa = d.get('initial.pa', r); pas.push(pa); if (pa <= LIMIT) pass++;
      const me = d.get('method', r); m[me] = (m[me] || 0) + 1;
      sumI += d.get('initial.ec', r);
      const b = d.get('best.ec', r); if (me !== 5 && b > 0) { sumB += b; nB++; }
    }
    pas.sort((a, b) => a - b);
    const med = pas[Math.floor(pas.length / 2)];
    const ei = ecFromDataset(sumI / rs.length), eb = ecFromDataset(sumB / nB);
    return `<div class="card" style="margin-top:12px"><div class="card-h">This slice <span class="sub">${rs.length.toLocaleString()} designs</span></div><div class="card-b">
      <div class="kpis" style="margin-top:0"><div class="kpi"><div class="k-l">Pass as built</div><div class="k-v">${fmt(100 * pass / rs.length, 1)}<span class="k-u">%</span></div></div>
      <div class="kpi"><div class="k-l">Median initial a<sub>p</sub></div><div class="k-v">${fmtFixed(med, 2)}<span class="k-u">%g</span></div></div>
      <div class="kpi"><div class="k-l">Mean initial EC</div><div class="k-v">${fmtFixed(ei.v, 2)}<span class="k-u">${ei.u}</span></div></div>
      <div class="kpi"><div class="k-l">Mean controlling EC</div><div class="k-v">${fmtFixed(eb.v, 2)}<span class="k-u">${eb.u}</span></div></div></div>
      <div style="margin-top:10px;height:12px;border-radius:6px;overflow:hidden;display:flex">${[1, 6, 4, 5].map(k => `<div title="${METHOD_LABELS[k]}: ${m[k] || 0}" style="width:${100 * (m[k] || 0) / rs.length}%;background:${METHOD_COLORS[k]}"></div>`).join('')}</div>
      <div class="legend">${[1, 6, 4, 5].filter(k => m[k]).map(k => `<span><i style="background:${METHOD_COLORS[k]}"></i>${METHOD_LABELS[k]} ${fmt(100 * m[k] / rs.length, 1)}%</span>`).join('')}</div></div></div>`;
  }

  // ---------------------------------------------------------------- figures
  async function loadFigs() { if (!figs) figs = await fetch('data/figures.json').then(r => r.json()); return figs; }
  async function renderGallery() {
    await loadFigs();
    renderInputs();
    $('#xTitle', root).textContent = 'Figures from the paper';
    $('#xCount', root).textContent = `${figs.figures.length} figures`;
    $('#xFoot', root).innerHTML = '<span>Click a figure to zoom (scroll / drag / double-click to reset)</span>';
    const gal = h('div', { class: 'gallery' });
    gal.style.height = '100%';
    for (const f of figs.figures) {
      gal.append(h('div', { class: 'fig-card', tabindex: 0, onclick: () => openFig(f.num), onkeydown: (e) => { if (e.key === 'Enter') openFig(f.num); } },
        h('div', { class: 'thumb' }, h('img', { src: f.thumb, alt: `Figure ${f.num}`, loading: 'lazy' })),
        h('div', { class: 'fc-b' }, h('div', { class: 'fc-n' }, `Figure ${f.num}`, h('span', { class: `pill ${f.kind === 'method' ? 'info' : 'pass'}` }, f.kind === 'method' ? 'method' : 'results')),
          h('div', { class: 'fc-c' }, f.caption))));
    }
    stage.append(gal);
    renderSelection(null);
  }

  async function openFig(num) {
    await loadFigs();
    const f = figs.figures.find(x => x.num === num);
    if (!f) return;
    const lb = $('#lb', root);
    const pre = FIG_PRESETS[num] || {};
    lb.hidden = false;
    lb.innerHTML = `<div class="lb-head"><h3>Figure ${num}</h3><span class="spacer"></span>
      <button class="btn btn-sm" id="lbPrev">‹ Prev</button><button class="btn btn-sm" id="lbNext">Next ›</button>
      ${pre.view ? '<button class="btn btn-sm btn-primary" id="lbExplore">Explore interactively</button>' : ''}
      ${pre.designer ? '<button class="btn btn-sm btn-primary" id="lbDesigner">Open the Bay Designer</button>' : ''}
      <a class="btn btn-sm" href="${f.full}" target="_blank" rel="noopener">Full size</a>
      <button class="btn btn-sm" id="lbClose" aria-label="Close">✕</button></div>
      <div class="lb-stage" id="lbStage"><img id="lbImg" src="${f.svg || f.full}" alt="Figure ${num}"></div>
      <div class="lb-foot"><b>Figure ${num}.</b> ${esc(f.caption)}${pre.note ? `<div class="why">${esc(pre.note)}</div>` : ''}</div>`;
    const img = $('#lbImg', lb), st = $('#lbStage', lb);
    let s = 1, tx = 0, ty = 0;
    const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
    const fit = () => {
      const W = st.clientWidth, H = st.clientHeight;
      const iw = img.naturalWidth || 1600, ih = img.naturalHeight || 1000;
      img.style.width = iw + 'px'; img.style.height = ih + 'px';
      s = Math.min((W - 40) / iw, (H - 20) / ih);
      tx = (W - iw * s) / 2; ty = (H - ih * s) / 2; apply();
    };
    img.onload = fit;
    if (img.complete) fit();
    st.onwheel = (e) => {
      e.preventDefault();
      const r = st.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * 0.0015), ns = Math.max(0.05, Math.min(8, s * k));
      tx = mx - (mx - tx) * ns / s; ty = my - (my - ty) * ns / s; s = ns; apply();
    };
    let drag = null;
    st.onpointerdown = (e) => { drag = [e.clientX - tx, e.clientY - ty]; st.classList.add('drag'); st.setPointerCapture(e.pointerId); };
    st.onpointermove = (e) => { if (!drag) return; tx = e.clientX - drag[0]; ty = e.clientY - drag[1]; apply(); };
    st.onpointerup = () => { drag = null; st.classList.remove('drag'); };
    st.ondblclick = fit;
    const close = () => { lb.hidden = true; lb.innerHTML = ''; document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { close(); openFig(num % 15 + 1); } if (e.key === 'ArrowLeft') { close(); openFig((num + 13) % 15 + 1); } };
    document.addEventListener('keydown', key);
    $('#lbClose', lb).onclick = close;
    $('#lbPrev', lb).onclick = () => { close(); openFig((num + 13) % 15 + 1); };
    $('#lbNext', lb).onclick = () => { close(); openFig(num % 15 + 1); };
    const ex = $('#lbExplore', lb);
    if (ex) ex.onclick = () => {
      close();
      Object.assign(F, { view: pre.view, system: pre.system || F.system, conc: 'all', deck: 'all', pcc: 'all' });
      if (pre.metric) F.metric = pre.metric;
      if (pre.x) Object.assign(F, { x: pre.x, y: pre.y, c: pre.c });
      sel = null; save(); renderAll();
    };
    const dz = $('#lbDesigner', lb);
    if (dz) dz.onclick = () => {
      close();
      if (typeof pre.designer === 'string') store.set('anTab', pre.designer);
      location.hash = '#/designer';
    };
  }

  // ---------------------------------------------------------------- wiring
  $$('#xView button', root).forEach(b => b.onclick = () => { F.view = b.dataset.v; save(); renderAll(); });
  $('#xSide', root).onclick = () => root.querySelector('.explore').classList.toggle('show-side');
  const onResize = debounce(() => { if (!root.closest('[hidden]') && F.view !== 'figs' && F.view !== 'land') renderStage(); }, 200);
  window.addEventListener('resize', onResize);
  let stageW = 0;   // panel splitters change the stage width without a window resize
  new ResizeObserver(() => { if (Math.abs(stage.clientWidth - stageW) > 2) { stageW = stage.clientWidth; onResize(); } }).observe(stage);
  onUnits(() => { if (!root.closest('[hidden]')) renderStage(); });

  return {
    async show(qs) {
      const q = new URLSearchParams(qs || '');
      if (q.has('fig')) { F.view = 'figs'; await renderAll(); openFig(+q.get('fig')); return; }
      if (q.has('view')) F.view = q.get('view');
      await renderAll();
    },
  };
}

// ---------------------------------------------------------------------------
// 3D landscape of the design space: x = girder span, z = infill span, height = metric
function makeLandscape(el, cells, { lo, hi, k, colorOf, top, bottom }, onHover, onClick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  el.append(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  cam.position.set(58, 52, 70);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.enableDamping = true;
  ctl.target.set(0, 6, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 60, 20); scene.add(sun);
  const H = 22;
  const geo = new THREE.BoxGeometry(0.92, 1, 0.92);
  geo.translate(0, 0.5, 0);
  const list = [...cells.values()].filter(c => Number.isFinite(c.v));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), list.length);
  const M = new THREE.Matrix4(), col = new THREE.Color();
  const target = [], cur = [];
  list.forEach((c, n) => {
    const t = (c.v - lo) / (hi - lo || 1);
    target.push(Math.max(0.05, t * H)); cur.push(0.05);
    col.set(colorOf(c));   // CSS colours are sRGB; three converts them to its working space
    mesh.setColorAt(n, col);
  });
  scene.add(mesh);
  // limit plane when height is peak acceleration
  if (k === 'ipa' && LIMIT >= lo && LIMIT <= hi) {
    const y = (LIMIT - lo) / (hi - lo || 1) * H;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(43, 43), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = y;
    scene.add(plane);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    edge.rotation.x = -Math.PI / 2; edge.position.y = y; scene.add(edge);
  }
  const grid = new THREE.GridHelper(42, 8, 0x5b6b7a, 0x2c3d50); grid.position.y = -0.01; scene.add(grid);
  // axis labels as sprites
  const label = (txt, x, y, z, w = 1) => {   // w: width in multiples of the axis-label size
    const c = document.createElement('canvas'); c.width = 256 * w; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#b4c0cc'; g.font = '28px system-ui'; g.textAlign = 'center'; g.fillText(txt, 128 * w, 40);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    s.scale.set(8 * w, 2, 1); s.position.set(x, y, z); scene.add(s);
  };
  label('girder span →', 0, 0.5, 24); label('infill span →', 24, 0.5, 0);
  // height scale: a post at the back corner, from 0 to the tallest bar's value
  const post = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-21, 0, -21), new THREE.Vector3(-21, H, -21)]),
    new THREE.LineBasicMaterial({ color: 0x8796a5 }));
  scene.add(post);
  label(bottom, -21, -1.2, -21, 1.6); label(top, -21, H + 1.4, -21, 1.6);
  if (k === 'ipa' && LIMIT >= lo && LIMIT <= hi) label('0.5 %g limit', -21, (LIMIT - lo) / (hi - lo || 1) * H + 1, -21, 1.6);
  for (const v of [10, 30, 50]) { label(`${v} ft`, v - 30, 0.5, 22.5); label(`${v} ft`, 22.5, 0.5, 30 - v); }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const pick = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, cam);
    const hit = ray.intersectObject(mesh)[0];
    return hit ? list[hit.instanceId] : null;
  };
  renderer.domElement.addEventListener('mousemove', (e) => onHover(pick(e), e));
  renderer.domElement.addEventListener('mouseleave', () => onHover(null));
  let down;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const c = pick(e); if (c) onClick(c); } down = null; });
  const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();
  let alive = true;
  renderer.setAnimationLoop(() => {
    if (!alive) return;
    let moving = false;
    list.forEach((c, n) => {
      const d = target[n] - cur[n];
      if (Math.abs(d) > 0.01) { cur[n] += d * 0.08; moving = true; }
      M.makeScale(1, cur[n], 1); M.setPosition(c.g - 30, 0, 30 - c.i);
      mesh.setMatrixAt(n, M);
    });
    if (moving) mesh.instanceMatrix.needsUpdate = true;
    ctl.update();
    renderer.render(scene, cam);
  });
  return { dispose() { alive = false; renderer.setAnimationLoop(null); ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); } };
}
