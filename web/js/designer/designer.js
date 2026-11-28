// Module 1: Bay Designer.
import { $, $$, h, esc, toast, debounce, downloadText, store } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { loadShapes, loadDataset } from '../lib/data.js';
import { fmt, fmtFixed, len, ecFromSolver, ecFromDataset, ecUnit, ecBay, getUnits, onUnits, LB_TO_KG, FT_TO_M } from '../lib/units.js';
import { METHOD_COLORS, METHOD_LABELS, GRADIENT } from '../lib/colormap.js';
import { interactiveScatter, stackedBar } from '../lib/charts.js';
import { Bay3D, DECK } from './bay3d.js';
import * as C from './calcs.js';
import { openReport } from './report.js';
import { mountCalcs } from './calcpanel.js';
import { columnSplitters } from '../lib/splitters.js';

const STATE_SHORT = { initial: 'Initial design', infill: 'Upsize infills', girder: 'Upsize girders', conc: 'Add topping', steel: 'Upsize infills + girders', best: 'Best design', check: 'Your design' };
const STATE_KEYS = ['initial', 'infill', 'girder', 'conc', 'steel', 'best'];
const STATE_COLOR = { initial: '#8b98a5', infill: '#85C1E9', girder: '#FCAE2E', conc: '#E57373', steel: '#4178BE', best: '#A3B376', check: '#ffffff' };

const DEFAULTS = { system: 'composite', mode: 'optimize', g: 30, i: 30, ninf: null, slab: null, conc: 0, deck: 3, pcc: 50, use: 3, clear: 3, fl: 200, fw: 200, is: null, gs: null, ci: null, cg: null, si: null, sg: null, view: 'best' };
// member-check overrides: state key -> request field (composite member check only; null = the solver's value)
const MEMBER_OVR = { ci: 'camber_infill', cg: 'camber_girder', si: 'studs_infill', sg: 'studs_girder' };
// most studs the solver's rib rule fits on a span (3 per rib, half-span count strictly below its maximum)
const maxStuds = (span) => 2 * Math.floor(1.5 * span) - 1;

export function createDesigner(root, ctx) {
  const S = { ...DEFAULTS, ...store.get('designer', {}), auto: store.get('auto', true) };
  let shapes = null, calcInfo = {}, result = null, running = false, pending = false, reqId = 0, ds = {};
  let bay = null, tab = store.get('anTab', 'valid'), varFilter = '';
  if (!['vars', 'valid', 'source'].includes(tab)) tab = 'valid';
  const calcState = { open: new Set(), filter: '' };
  // beam count and slab depth are Custom-design inputs: Optimize always uses the solver's own rules
  const nInf = () => (S.mode === 'check' ? S.ninf : null);
  const slabT = () => (S.mode === 'check' ? S.slab : null);
  let calcApi = null;

  // ------------------------------------------------------------------ layout
  root.innerHTML = `
  <div class="designer">
    <aside class="d-left" id="dIn"></aside>
    <div class="d-center">
      <div class="viewport" id="vp">
        <div class="vp-toolbar" id="vpTools"></div>
        <div class="vp-hud" id="vpHud"></div>
        <div class="vp-bottom" id="vpBottom"></div>
        <div class="vp-overlay" id="vpOverlay"></div>
      </div>
    </div>
    <aside class="d-right" id="dOut"><div class="muted" style="padding:10px">Starting the solver…</div></aside>
  </div>
  <dialog class="dlg an-dlg" id="anDlg" aria-label="Engine details">
    <div class="analysis" id="an">
      <div class="an-tabs" id="anTabs"></div>
      <div class="an-body" id="anBody"><div class="muted">Run the solver to see every calculation.</div></div>
    </div>
  </dialog>`;

  columnSplitters(root.querySelector('.designer'), 'cols.designer');
  const vp = $('#vp', root);
  bay = new Bay3D(vp, {
    onProbe: (p) => { probe = p; renderHud(); },
    onHover: (p) => { hover = p; renderHudLive(); },
    onPick: (kind) => { if (kind) { toast(`${kind[0].toUpperCase() + kind.slice(1)} — its checks are open in Calculations.`); calcApi?.openGroup('checks'); } },
    onWalk: (w) => { walk = w; renderHudLive(); },
    onSection: (t) => { const s = $('#cutSl', root); if (s) s.value = t; },
  });
  let probe = null, hover = null, walk = null;

  // ------------------------------------------------------------------ inputs
  function deckIcon(hr) {
    const d = DECK[hr]; const p = d.pitch, W = 72, H = 22, sc = W / 24, ys = 10 / 3;
    let path = `M0 ${H - 3}`;
    for (let x0 = 0; x0 < 24; x0 += p) {
      path += ` L${(x0 + d.bottom / 2) * sc} ${H - 3} L${(x0 + d.top / 2) * sc} ${H - 3 - hr * ys} L${(x0 + p - d.top / 2) * sc} ${H - 3 - hr * ys} L${(x0 + p - d.bottom / 2) * sc} ${H - 3}`;
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${path} L${W} ${H - 3}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
  }

  function planSVG() {
    const g = S.g, i = S.i, k = 120 / Math.max(g, i);
    const w = g * k, hh = i * k, ox = (130 - w) / 2, oy = (130 - hh) / 2;
    const look = S.conc === 1 ? 1 : 0;
    const smax = window.__msveMeta?.systems?.[S.system]?.spacing_lookup?.[`${look}|${S.deck}`] || 10;
    const N = result?.ok ? (result.captured?.[S.view === 'check' ? 'check' : 'initial']?.values?.NumInfill ?? null) : null;
    const n = nInf() || N || Math.max(1, Math.ceil(g / smax - 1));
    let lines = '';
    for (let q = 0; q <= n + 1; q++) {
      const x = ox + w * q / (n + 1);
      lines += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + hh}" stroke="#85C1E9" stroke-width="${q === 0 || q === n + 1 ? 2 : 1.4}"/>`;
    }
    return `<svg viewBox="0 0 130 130" width="130" height="130" aria-label="Framing plan">
      <rect x="${ox}" y="${oy}" width="${w}" height="${hh}" fill="rgba(133,193,233,.06)" stroke="none"/>
      ${lines}
      <line x1="${ox}" y1="${oy}" x2="${ox + w}" y2="${oy}" stroke="#FCAE2E" stroke-width="3"/>
      <line x1="${ox}" y1="${oy + hh}" x2="${ox + w}" y2="${oy + hh}" stroke="#FCAE2E" stroke-width="3"/>
      ${[[ox, oy], [ox + w, oy], [ox, oy + hh], [ox + w, oy + hh]].map(([x, y]) => `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#8b98a5"/>`).join('')}
      <text x="65" y="${oy - 5}" text-anchor="middle" font-size="9" fill="#FCAE2E">girder ${g} ft</text>
      <text x="${ox + w + 5}" y="65" font-size="9" fill="#85C1E9" transform="rotate(90 ${ox + w + 5} 65)" text-anchor="middle">infill ${i} ft</text>
    </svg>`;
  }

  const help = (t) => `<button type="button" class="help" data-help="${esc(t)}" aria-label="Help">?</button>`;
  function spanField(key, label, hint) {
    return `<div class="field" data-f="${key}">
      <div class="field-label"><span>${label}${help(hint)}</span><span class="hint" id="${key}M"></span></div>
      <div class="range-row"><input type="range" min="6" max="60" step="1" id="${key}R" aria-label="${label}">
      <div class="num-box"><input type="number" min="6" max="60" step="1" id="${key}N" aria-label="${label} in feet"><span>ft</span></div></div>
    </div>`;
  }

  function buildInputs() {
    const bu = window.__msveMeta?.systems?.composite?.building_uses || {};
    const useName = (k) => (bu[k] || [])[0] || ['', 'Paper office', 'Electronic office', 'Residence', 'Assembly area'][k];
    $('#dIn', root).innerHTML = `
      <div class="quick-card stale-dim" id="quick" aria-live="polite" hidden></div>
      <div class="panel-title">Floor system</div>
      <div class="seg seg-block" id="sysSeg" style="margin-bottom:12px">
        <button data-v="composite">Composite</button><button data-v="noncomposite">Non-composite</button>
      </div>
      <div class="mode-cards" id="modeCards">
        <button class="mode-card" data-v="optimize"><b>Optimize for me</b><span>Paper's solver picks the lowest-carbon members that pass</span></button>
        <button class="mode-card" data-v="check"><b>Custom design</b><span>Set the members, framing, slab, camber and studs yourself; see every check</span></button>
      </div>
      <div id="checkPick" class="custom-mod" hidden>
        <div class="custom-h">Custom design <span>blank or Auto = the solver's own rule</span></div>
        <div class="field"><div class="field-label"><span>Infill beam W-shape${help('The beams that span between the girders (length L_j). Type to search, e.g. W16X26.')}</span></div><div class="shape-pick" id="isPick"></div></div>
        <div class="field"><div class="field-label"><span>Girder W-shape${help('The two beams on the column lines that carry the infills (length L_g).')}</span></div><div class="shape-pick" id="gsPick"></div></div>
        <div class="field"><div class="field-label"><span>Beams between girders${help('Number of interior infill beams. Auto: the paper\'s solver sets it from the deck table (the widest spacing a 22 ga deck with minimum topping can span).')}</span><span class="hint" id="ninfV"></span></div>
          <div class="row"><div class="seg" id="ninfAuto"><button data-v="auto">Auto</button></div>
            <div class="num-box" style="flex:1"><button type="button" class="btn btn-ghost btn-sm" id="ninfDn" aria-label="Fewer beams" style="border:0;padding:4px 10px">−</button>
            <input type="number" id="ninfN" min="1" max="14" step="1" aria-label="Number of interior beams" style="width:40px;text-align:center;padding-left:0">
            <button type="button" class="btn btn-ghost btn-sm" id="ninfUp" aria-label="More beams" style="border:0;padding:4px 10px">+</button><span style="margin-left:auto">beams</span></div></div></div>
        <div class="field"><div class="field-label"><span>Total slab depth${help('Deck rib depth plus concrete above the ribs. Auto: the solver picks the lightest deck and topping in its table that carry the load. The other options are the depths the deck table offers for the deck and concrete chosen under Slab.')}</span><span class="hint" id="slabV"></span></div>
          <div class="seg seg-block" id="slabSeg"></div></div>
        <div class="field" id="ovrField"><div class="field-label"><span>Camber and studs${help('Optional. Leave a box blank and the paper\'s solver sets the value (shown in grey). Solver camber: 0.8 × the construction deflection, rounded to ¼ in, only when that exceeds ⅝ in on spans of 24 ft or more. Solver studs: the fewest ¾ in studs that reach the degree of composite action. A number you type replaces the solver\'s value on that member. Your studs then set ΣQn (half the studs on each side of midspan × Qn, up to full composite), the solver\'s rule for fitting them in the ribs is kept, and the member must still reach 25 % composite.')}</span><button type="button" class="link-btn" id="ovrReset">Use solver values</button></div>
          <table class="ovr"><tr><th></th><th>Infill beam</th><th>Girder</th></tr>
            <tr><td>Camber</td><td><div class="num-box" id="ciB"><input type="number" id="ciN" min="0" max="4" step="0.25" aria-label="Infill camber in inches (blank = solver)"><span>in</span></div></td>
              <td><div class="num-box" id="cgB"><input type="number" id="cgN" min="0" max="4" step="0.25" aria-label="Girder camber in inches (blank = solver)"><span>in</span></div></td></tr>
            <tr><td>Studs</td><td><div class="num-box" id="siB"><input type="number" id="siN" min="0" step="1" aria-label="Studs on one infill beam (blank = solver)"><span>ea</span></div></td>
              <td><div class="num-box" id="sgB"><input type="number" id="sgN" min="0" step="1" aria-label="Studs on one girder (blank = solver)"><span>ea</span></div></td></tr></table>
          <div class="sub-unit" id="ovrInfo"></div></div>
        <button class="btn btn-sm btn-ghost" id="useOpt" style="margin:-4px 0 12px">Start from the optimizer's design</button>
      </div>
      <div id="assume"></div>

      <div class="panel-title">Bay</div>
      <div style="display:flex;justify-content:center;margin:-4px 0 6px" id="plan"></div>
      ${spanField('g', 'Girder span L<sub>g</sub>', 'Column to column along the girders. The beams frame into the girders and the deck ribs run parallel to the girders. Paper studied 10–50 ft.')}
      ${spanField('i', 'Beam span L<sub>j</sub>', 'Span of the infill (filler) beams, girder to girder. Paper studied 10–50 ft.')}

      <div class="panel-title">Slab</div>
      <div class="field"><div class="field-label"><span>Concrete</span></div>
        <div class="seg seg-block" id="concSeg"><button data-v="0">Normal-weight <span class="muted tiny">145 pcf</span></button><button data-v="1">Lightweight <span class="muted tiny">110 pcf</span></button></div></div>
      <div class="field"><div class="field-label"><span>Deck rib depth${help('Composite steel deck profile (VL type). The solver picks the gauge and the concrete above the ribs from its deck table, for the infill spacing it chose.')}</span></div>
        <div class="deck-icons" id="deckBtns">${[1.5, 2, 3].map(d => `<button class="deck-btn" data-v="${d}">${deckIcon(d)}${d}" deck</button>`).join('')}</div></div>
      <div class="field" id="pccField"><div class="field-label"><span>Degree of composite action${help('Partial composite connection: ΣQn as a percent of the force for full composite action (AISC 360 I3). The solver sizes the studs to reach it. Paper studied 25, 50 and 75 %; above about 80 % the studs often cannot fit.')}</span><span class="hint" id="pccV"></span></div>
        <div class="row"><div class="seg seg-block" id="pccSeg" style="flex:1"><button data-v="25">25 %</button><button data-v="50">50 %</button><button data-v="75">75 %</button></div>
        <div class="num-box" title="Other value, 25–90 % in 5 % steps (outside the study)"><input type="number" id="pccN" min="25" max="90" step="5" aria-label="Other degree of composite action, percent"><span>%</span></div></div></div>

      <div class="panel-title">Occupancy</div>
      <div class="field"><select id="useSel" aria-label="Occupancy">${[3, 1, 2, 4].map(k => `<option value="${k}">${k === 3 ? 'Residence — study default' : useName(k)}</option>`).join('')}</select>
        <div class="sub-unit" id="useInfo"></div></div>

      <details class="adv" id="adv"><summary>Advanced inputs</summary>
        <div class="field"><div class="field-label"><span>Deck construction spans${help('Which column of the SDI/Vulcraft deck table the solver uses for the maximum unshored deck span: deck continuous over 1, 2 or 3 spans during construction. The paper used 3. This is not the DG 11 beam-continuity factor (the solver always applies 1.5 to W_j).')}</span></div>
          <div class="seg seg-block" id="clearSeg"><button data-v="1">Single</button><button data-v="2">Double</button><button data-v="3">Triple</button></div></div>
        <div class="field"><div class="field-label"><span>Floor extent${help('Report-only. The solver checks B_j ≤ 2/3 of the floor width and B_g ≤ 2/3 of the floor length and reports the result; it does not cap B_j or B_g. Default 200 × 200 ft, as in the paper.')}</span></div>
          <div class="row"><div class="num-box" style="flex:1" title="Floor dimension along the girders — limits B_j"><input type="number" id="fwN" min="20" max="2000" aria-label="Floor width along the girders in feet (limits B_j)"><span>ft along girders</span></div></div>
          <div class="row" style="margin-top:6px"><div class="num-box" style="flex:1" title="Floor dimension along the infills — limits B_g"><input type="number" id="flN" min="20" max="2000" aria-label="Floor length along the infills in feet (limits B_g)"><span>ft along infills</span></div></div>
          <div class="sub-unit">width along girders limits B<sub>j</sub>; length along infills limits B<sub>g</sub></div></div>
      </details>


      <div id="inWarn"></div>
      <div class="run-row">
        <button class="btn btn-primary btn-block" id="runBtn">Run the paper's solver</button>
        <div class="auto-row"><span id="runStat">&nbsp;</span>
          <label class="row" title="Re-run automatically when an input changes">Auto <span class="switch"><input type="checkbox" id="autoChk"><span></span></span></label></div>
      </div>`;
    bindInputs();
    syncInputs();
  }

  function bindInputs() {
    const R = root;
    $$('#sysSeg button', R).forEach(b => b.onclick = () => set({ system: b.dataset.v }));
    $$('#modeCards .mode-card', R).forEach(b => b.onclick = () => set({ mode: b.dataset.v, view: b.dataset.v === 'check' ? 'check' : 'best' }));
    for (const k of ['g', 'i']) {
      $(`#${k}R`, R).oninput = (e) => set({ [k]: +e.target.value }, { quiet: true });
      $(`#${k}R`, R).onchange = (e) => set({ [k]: +e.target.value });
      $(`#${k}N`, R).onchange = (e) => { let v = Math.round(+e.target.value); if (!Number.isFinite(v)) v = S[k]; v = Math.max(6, Math.min(60, v)); set({ [k]: v }); };
    }
    $$('#concSeg button', R).forEach(b => b.onclick = () => set({ conc: +b.dataset.v }));
    $$('#deckBtns button', R).forEach(b => b.onclick = () => set({ deck: +b.dataset.v }));
    $$('#ninfAuto button', R).forEach(b => b.onclick = () => set({ ninf: null }));
    const nset = (v) => set({ ninf: Math.max(1, Math.min(14, Math.round(v))) });
    $('#ninfDn', R).onclick = () => nset((S.ninf || autoBeams()) - 1);
    $('#ninfUp', R).onclick = () => nset((S.ninf || autoBeams()) + 1);
    $('#ninfN', R).onchange = (e) => { const v = +e.target.value; if (Number.isFinite(v) && v >= 1) nset(v); else set({ ninf: null }); };
    $$('#pccSeg button', R).forEach(b => b.onclick = () => set({ pcc: +b.dataset.v }));
    $('#pccN', R).onchange = (e) => { let v = Math.round((+e.target.value || 50) / 5) * 5; v = Math.max(25, Math.min(90, v)); set({ pcc: v }); };
    $('#useSel', R).onchange = (e) => set({ use: +e.target.value });
    $$('#clearSeg button', R).forEach(b => b.onclick = () => set({ clear: +b.dataset.v }));
    $('#flN', R).onchange = (e) => set({ fl: Math.max(20, Math.min(2000, +e.target.value || 200)) });
    $('#fwN', R).onchange = (e) => set({ fw: Math.max(20, Math.min(2000, +e.target.value || 200)) });
    $('#runBtn', R).onclick = () => run(true);
    $('#autoChk', R).onchange = (e) => { S.auto = e.target.checked; store.set('auto', S.auto); if (S.auto) run(); };
    for (const k of Object.keys(MEMBER_OVR)) {
      $(`#${k}N`, R).onchange = (e) => {
        const raw = e.target.value.trim();
        let v = +raw;
        if (raw === '' || !Number.isFinite(v) || v < 0) return set({ [k]: null });
        v = k[0] === 'c' ? Math.min(4, Math.round(v * 4) / 4) : Math.min(maxStuds(k === 'si' ? S.i : S.g), Math.round(v));
        set({ [k]: v });
      };
    }
    $('#ovrReset', R).onclick = () => set({ ci: null, cg: null, si: null, sg: null });
    $('#useOpt', R).onclick = () => {
      const st = result?.states?.best || result?.states?.initial;
      if (st?._applies) set({ is: st['Infill Sizes'], gs: st['Girder Sizes'] });
    };
  }

  function syncInputs() {
    const R = root;
    $$('#sysSeg button', R).forEach(b => b.classList.toggle('on', b.dataset.v === S.system));
    $$('#modeCards .mode-card', R).forEach(b => b.classList.toggle('on', b.dataset.v === S.mode));
    for (const k of ['g', 'i']) {
      $(`#${k}R`, R).value = S[k]; $(`#${k}N`, R).value = S[k];
      $(`#${k}M`, R).textContent = `${fmtFixed(S[k] * FT_TO_M, 2)} m`;
      R.querySelector(`.field[data-f="${k}"]`).classList.toggle('warn', S[k] < 10 || S[k] > 50);
    }
    $$('#concSeg button', R).forEach(b => b.classList.toggle('on', +b.dataset.v === S.conc));
    $$('#deckBtns button', R).forEach(b => b.classList.toggle('on', +b.dataset.v === S.deck));
    const nb = S.ninf || autoBeams();
    $$('#ninfAuto button', R).forEach(b => b.classList.toggle('on', !S.ninf));
    $('#ninfN', R).value = nb;
    $('#ninfV', R).textContent = `@ ${fmtFixed(S.g / (nb + 1), 2)} ft${S.ninf ? ' · set by you' : ''}`;
    const opts = slabOptions();
    if (S.slab && !opts.includes(S.slab)) S.slab = null;
    $('#slabSeg', R).innerHTML = `<button data-v="auto" class="${S.slab ? '' : 'on'}">Auto</button>` + opts.map(t => `<button data-v="${t}" class="${S.slab === t ? 'on' : ''}">${t}"</button>`).join('');
    $$('#slabSeg button', R).forEach(b => b.onclick = () => set({ slab: b.dataset.v === 'auto' ? null : +b.dataset.v }));
    $('#slabV', R).textContent = S.slab ? `${fmtFixed(S.slab - S.deck, 2)}" above ribs · set by you` : 'lightest that works';
    $('#pccField', R).hidden = S.system !== 'composite';
    $$('#pccSeg button', R).forEach(b => b.classList.toggle('on', +b.dataset.v === S.pcc));
    $('#pccN', R).value = S.pcc;
    $('#pccV', R).textContent = [25, 50, 75].includes(S.pcc) ? '' : `${S.pcc} % · outside the study`;
    $('#useSel', R).value = S.use;
    const bu = window.__msveMeta?.systems?.composite?.building_uses?.[S.use];
    $('#useInfo', R).innerHTML = bu ? `From the solver's occupancy table: live load ${bu[3]} psf · DG 11 vibration live load ${bu[1]} psf · damping β = ${bu[4]} · tolerance ${bu[2]} %g. Damping is set by the occupancy (the published solver has no damping input).` : '';
    $$('#clearSeg button', R).forEach(b => b.classList.toggle('on', +b.dataset.v === S.clear));
    $('#flN', R).value = S.fl; $('#fwN', R).value = S.fw;
    $('#checkPick', R).hidden = S.mode !== 'check';
    $('#ovrField', R).hidden = S.system !== 'composite';
    for (const k of Object.keys(MEMBER_OVR)) {
      const inp = $(`#${k}N`, R);
      if (document.activeElement !== inp) inp.value = S[k] ?? '';
      const sv = solverVal(k);
      inp.placeholder = sv === null || sv === undefined ? 'auto' : `auto ${k[0] === 'c' ? fmt(sv, 2) : fmt(sv, 0)}`;
      $(`#${k}B`, R).classList.toggle('set', S[k] !== null && S[k] !== undefined);
    }
    $('#siN', R).max = maxStuds(S.i); $('#sgN', R).max = maxStuds(S.g);
    $('#ovrReset', R).disabled = !memberOverrides();
    $('#ovrInfo', R).innerHTML = (memberOverrides() ? '<span style="color:var(--warn)">Set by you.</span> ' : 'Blank = the solver\'s value. ') +
      `Up to ${maxStuds(S.i)} studs fit on an infill and ${maxStuds(S.g)} on a girder (3 per rib).`;
    renderAssume();
    $('#autoChk', R).checked = !!S.auto;
    $('#plan', R).innerHTML = planSVG();
    if (S.mode === 'check' && shapes) { picker('#isPick', 'is'); picker('#gsPick', 'gs'); }
    const warn = [];
    if (S.g < 10 || S.g > 50 || S.i < 10 || S.i > 50) warn.push('Spans outside 10–50 ft are outside the paper\'s design space.');
    if (S.system === 'composite' && ![25, 50, 75].includes(S.pcc)) warn.push(`${S.pcc} % composite was not studied in the paper${S.pcc > 75 ? ' (above ~80 % the studs often cannot reach it).' : '.'}`);
    if (S.use !== 3) warn.push('The paper studied residential floors only.');
    $('#inWarn', R).innerHTML = warn.length ? `<div class="warn-box"><b>Outside the study</b> — ${warn.join(' ')}</div>` : '';
  }

  // searchable W-shape combobox
  function picker(sel, key) {
    const box = $(sel, root);
    const names = shapes.names.slice().sort((a, b) => {
      const da = shapes.byName[a].d, db = shapes.byName[b].d;
      return da - db || shapes.byName[a].W - shapes.byName[b].W;
    });
    box.innerHTML = `<input class="text-in" placeholder="e.g. W16X26" value="${esc(S[key] || '')}" aria-label="W-shape">`;
    const inp = box.firstChild;
    let list = null, hl = -1, matches = [];
    const close = () => { list?.remove(); list = null; };
    const show = () => {
      const q = inp.value.trim().toUpperCase().replace(/\s/g, '');
      matches = names.filter(n => !q || n.includes(q)).slice(0, 80);
      close();
      list = h('div', { class: 'shape-list' });
      matches.forEach((n, idx) => {
        const d = shapes.byName[n];
        list.append(h('div', { class: idx === hl ? 'hl' : '', onmousedown: (e) => { e.preventDefault(); choose(n); } }, n, h('span', {}, `d ${d.d}" · ${d.W} lb/ft`)));
      });
      box.append(list);
    };
    const choose = (n) => { inp.value = n; close(); set({ [key]: n }); };
    inp.onfocus = show;
    inp.oninput = () => { hl = 0; show(); };
    inp.onblur = () => { setTimeout(close, 120); const v = inp.value.trim().toUpperCase(); if (shapes.byName[v] && v !== S[key]) set({ [key]: v }); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { hl = Math.min(matches.length - 1, hl + 1); show(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); show(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (matches[hl] || matches[0]) choose(matches[hl] ?? matches[0]); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    };
  }

  function set(patch, { quiet = false } = {}) {
    Object.assign(S, patch);
    store.set('designer', { ...S, auto: undefined });
    syncInputs();
    writeHash();
    preview();
    if (!quiet && S.auto) runSoon();
  }

  // ------------------------------------------------------------------ URL
  function writeHash() {
    const q = new URLSearchParams({ sys: S.system === 'composite' ? 'c' : 'nc', g: S.g, i: S.i, c: S.conc, d: S.deck, p: S.pcc, u: S.use, cs: S.clear, fl: S.fl, fw: S.fw, m: S.mode === 'check' ? 'chk' : 'opt' });
    if (S.mode === 'check') { if (S.is) q.set('is', S.is); if (S.gs) q.set('gs', S.gs); }
    if (S.view && S.view !== 'best') q.set('st', S.view);
    if (nInf()) q.set('n', nInf());
    if (slabT()) q.set('sl', slabT());
    if (memberOverrides()) for (const k of Object.keys(MEMBER_OVR)) if (S[k] !== null && S[k] !== undefined) q.set(k, S[k]);
    history.replaceState(null, '', `#/designer?${q}`);
  }
  function readHash(qs) {
    if (!qs) return;
    const q = new URLSearchParams(qs);
    const num = (k, d) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : d);
    if (q.has('sys')) S.system = q.get('sys') === 'nc' ? 'noncomposite' : 'composite';
    S.g = Math.max(6, Math.min(60, Math.round(num('g', S.g))));
    S.i = Math.max(6, Math.min(60, Math.round(num('i', S.i))));
    S.conc = num('c', S.conc) ? 1 : 0;
    S.deck = [1.5, 2, 3].includes(num('d', S.deck)) ? num('d', S.deck) : 3;
    S.pcc = Math.max(25, Math.min(90, Math.round(num('p', S.pcc) / 5) * 5));
    S.use = [1, 2, 3, 4].includes(num('u', S.use)) ? num('u', S.use) : 3;
    S.clear = [1, 2, 3].includes(num('cs', S.clear)) ? num('cs', S.clear) : 3;
    S.fl = num('fl', S.fl); S.fw = num('fw', S.fw);
    if (q.has('m')) S.mode = q.get('m') === 'chk' ? 'check' : 'optimize';
    if (q.has('is')) S.is = q.get('is').toUpperCase();
    if (q.has('gs')) S.gs = q.get('gs').toUpperCase();
    S.view = q.get('st') || (S.mode === 'check' ? 'check' : 'best');
    S.ninf = q.has('n') && +q.get('n') >= 1 ? Math.min(14, Math.round(+q.get('n'))) : null;
    S.slab = q.has('sl') && +q.get('sl') > 0 ? +q.get('sl') : null;
    for (const k of Object.keys(MEMBER_OVR)) S[k] = q.has(k) && q.get(k) !== '' && Number.isFinite(+q.get(k)) && +q.get(k) >= 0 ? +q.get(k) : null;
  }

  // ------------------------------------------------------------------ solver
  const runSoon = debounce(() => run(), 650);
  // static build: the in-browser engine reports what it is doing (loading Python, then solving)
  window.addEventListener('msve-engine', (e) => {
    const o = $('#vpOverlay .solving', root);
    if (o && !e.detail.ready) o.lastChild.textContent = e.detail.text;
  });

  function autoBeams() {
    const smax = window.__msveMeta?.systems?.[S.system]?.spacing_lookup?.[`${S.conc}|${S.deck}`] || 10;
    return Math.max(1, Math.ceil(S.g / smax - 1));     // the solver's rule, for display only
  }
  // member-check overrides that apply to this request (composite member check only)
  function memberOverrides() {
    if (S.mode !== 'check' || S.system !== 'composite') return null;
    const o = {};
    for (const [k, f] of Object.entries(MEMBER_OVR)) if (S[k] !== null && S[k] !== undefined) o[f] = k[0] === 's' ? Math.min(maxStuds(k === 'si' ? S.i : S.g), S[k]) : S[k];
    return Object.keys(o).length ? o : null;
  }
  // the solver's own camber / studs for the checked pair, remembered from the last run that did not override them
  let solverMem = { key: null };
  const memberKey = (r) => JSON.stringify([r.system, r.girder_span, r.infill_span, r.conc_type, +r.deck_type, r.percent_comp, r.building_use, r.clear_spans, r.num_infill || null, r.slab_total || null, r.infill_shape, r.girder_shape]);
  function rememberSolver(res) {
    const v = res.captured?.check?.values;
    if (!v || res.system !== 'composite') return;
    const r = res.request, key = memberKey(r);
    if (solverMem.key !== key) solverMem = { key };
    const src = { ci: v.camber_II, cg: v.camber_IG, si: v.min_req_studs_II, sg: v.min_req_studs_IG };
    for (const [k, f] of Object.entries(MEMBER_OVR)) if (r[f] === null || r[f] === undefined) solverMem[k] = src[k];
  }
  function solverVal(k) { return solverMem.key === memberKey(request()) ? solverMem[k] : null; }
  function slabOptions() { return window.__msveMeta?.slab_options?.[`${S.conc}|${S.deck}`] || []; }

  function request() {
    const b = { system: S.system, girder_span: S.g, infill_span: S.i, conc_type: S.conc, deck_type: S.deck, percent_comp: S.pcc, building_use: S.use, clear_spans: S.clear, floor_length: S.fl, floor_width: S.fw, mode: S.mode };
    if (S.mode === 'check') { b.infill_shape = S.is; b.girder_shape = S.gs; }
    if (nInf()) b.num_infill = nInf();
    if (slabT()) b.slab_total = slabT();
    Object.assign(b, memberOverrides() || {});
    return b;
  }

  async function run(force = false) {
    if (S.mode === 'check' && (!S.is || !S.gs)) {
      if (result?.ok) { const st = result.states.best?._applies ? result.states.best : result.states.initial; if (st?._applies) { S.is = S.is || st['Infill Sizes']; S.gs = S.gs || st['Girder Sizes']; syncInputs(); } }
      if (!S.is || !S.gs) { S.mode = 'optimize'; syncInputs(); }
    }
    if (running) { pending = true; return; }
    running = true; pending = false;
    const my = ++reqId;
    const t0 = performance.now();
    $('#runBtn', root).disabled = true;
    $('#runBtn', root).innerHTML = '<span class="spinner"></span> Solving…';
    if (result) {
      root.querySelector('.designer').classList.add('is-stale');
      if (!$('#staleB', root)) $('#dOut', root).insertAdjacentHTML('afterbegin', '<div class="stale-badge" id="staleB"><span class="spinner"></span>Recomputing — values below are for the previous inputs</div>');
    }
    $('#vpOverlay', root).innerHTML = `<div class="solving"><span class="spinner"></span>Running the paper's ${S.system === 'composite' ? 'composite' : 'non-composite'} solver…</div>`;
    try {
      const sys = S.system;
      if (!calcInfo[sys]) {
        const cm = await api.calcmap(sys);
        const linesByNo = {}, linesByVar = {};
        for (const l of cm.lines) { linesByNo[l.line] = l; (linesByVar[l.var] ||= []).push(l); }
        calcInfo[sys] = { ...cm, linesByNo, linesByVar };
      }
      const res = await api.design(request());
      if (my !== reqId) return;
      res._clientMs = performance.now() - t0;
      result = res;
      if (res.ok) {
        rememberSolver(res);
        if (S.mode === 'check') S.view = 'check';
        else if (!res.captured[S.view]) S.view = res.captured.best ? 'best' : 'initial';
        await matchDataset(res);
      }
      renderAll();
      $('#runStat', root).textContent = res.ok ? `Solved in ${fmt(res.timing_s?.total ?? res._clientMs / 1000, 1)} s${res.timing_s?.total === undefined ? '' : ''}` : 'No design';
    } catch (e) {
      if (e.status === 503) toast('The solver is busy with other designs — retrying in a moment…', 'err');
      else toast(`Solver request failed: ${e.message}`, 'err');
      if (e.status === 503) setTimeout(() => run(), 2500);
    } finally {
      running = false;
      $('#runBtn', root).disabled = false;
      $('#runBtn', root).textContent = "Run the paper's solver";
      $('#vpOverlay', root).innerHTML = '';
      root.querySelector('.designer').classList.remove('is-stale');
      $('#staleB', root)?.remove();
      if (pending) run();
    }
  }

  // ------------------------------------------------------------------ dataset (instant preview + validation)
  function onGrid() {
    return !nInf() && !slabT() && !memberOverrides() && S.use === 3 && S.clear === 3 && S.fl === 200 && S.fw === 200 && S.g >= 10 && S.g <= 50 && S.i >= 10 && S.i <= 50 &&
      (S.system === 'noncomposite' || [25, 50, 75].includes(S.pcc));
  }
  async function getDs(sys) { if (!ds[sys]) ds[sys] = await loadDataset(sys); return ds[sys]; }

  async function preview() {
    if (!bay || !shapes || !onGrid()) return;
    if (result?.ok && sameInputs(result)) return;
    try {
      const d = await getDs(S.system);
      const row = d.find({ g: S.g, i: S.i, conc: S.conc, deck: S.deck, pcc: S.pcc });
      if (row === undefined) return;
      const key = S.mode === 'check' ? 'initial' : 'best';
      const st = d.state(row, key) || d.state(row, 'initial');
      if (!st) return;
      const look = S.conc === 1 ? 1 : 0;
      const smax = window.__msveMeta.systems[S.system].spacing_lookup[`${look}|${S.deck}`];
      const N = Math.max(1, Math.ceil(S.g / smax - 1));
      const m = {
        composite: S.system === 'composite', Lg: S.g, Lj: S.i, N, s: S.g / (N + 1), hr: S.deck,
        tc: (d.get('initial.top', row) || 2), add: key === 'best' ? Math.max(0, (d.get('best.top', row) || 0) - (d.get('initial.top', row) || 0)) : 0,
        deckLabel: `${S.deck}" deck (published dataset)`,
        infill: { name: st.infill, dims: shapes.byName[st.infill], studs: st.infill_studs || 0, perRib: 1, camber: st.infill_camber || 0 },
        girder: { name: st.girder, dims: shapes.byName[st.girder], studs: st.girder_studs || 0, perRib: 1, camber: st.girder_camber || 0 },
        vib: { dj: 0.5, dg: 0.5, fn: st.fn, ap: st.pa, limit: 0.5, beta: window.__msveMeta?.systems?.[S.system]?.building_uses?.[S.use]?.[4] },
        preview: true,
      };
      bay.setModel(m, { animateIn: false });
    } catch { /* dataset not available -- the solver result will draw the bay */ }
  }

  function sameInputs(res) {
    const r = res.request || {};
    return r.system === S.system && r.girder_span === S.g && r.infill_span === S.i && r.conc_type === S.conc && +r.deck_type === S.deck &&
      (S.system === 'noncomposite' || r.percent_comp === S.pcc) && r.building_use === S.use && r.clear_spans === S.clear &&
      (r.num_infill || null) === (nInf() || null) && (r.slab_total || null) === (slabT() || null) &&
      Object.values(MEMBER_OVR).every(f => (r[f] ?? null) === ((memberOverrides() || {})[f] ?? null));
  }

  async function matchDataset(res) {
    res._match = null;
    // beam count / slab depth set by the user: not the paper's method, so not compared with its dataset
    // (camber and studs apply to the checked pair only; the optimizer's states are the solver's own)
    if (res.variant && (res.variant.infill_count || res.variant.slab_total)) return;
    const r = res.request;
    const grid = r.building_use === 3 && r.clear_spans === 3 && r.floor_length === 200 && r.floor_width === 200 &&
      r.girder_span >= 10 && r.girder_span <= 50 && r.infill_span >= 10 && r.infill_span <= 50 &&
      (r.system === 'noncomposite' || [25, 50, 75].includes(r.percent_comp));
    if (!grid) return;
    let d;
    try { d = await getDs(r.system); } catch { return; }
    const row = d.find({ g: r.girder_span, i: r.infill_span, conc: r.conc_type, deck: r.deck_type, pcc: r.percent_comp });
    if (row === undefined) return;
    const checks = [];
    const close = (a, b, tol = 2e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
    for (const k of STATE_KEYS) {
      const st = res.states[k];
      const pub = d.state(row, k);
      if (!st?._applies && !pub) continue;
      if (!st?._applies || !pub) { checks.push({ state: k, field: 'applies', solver: !!st?._applies, dataset: !!pub, ok: false }); continue; }
      checks.push({ state: k, field: 'infill', solver: st['Infill Sizes'], dataset: pub.infill, ok: st['Infill Sizes'] === pub.infill });
      checks.push({ state: k, field: 'girder', solver: st['Girder Sizes'], dataset: pub.girder, ok: st['Girder Sizes'] === pub.girder });
      checks.push({ state: k, field: 'peak accel.', solver: st['Peak Acceleration'], dataset: pub.pa, ok: close(st['Peak Acceleration'], pub.pa) });
      checks.push({ state: k, field: 'frequency', solver: st['Fundamental Frequency'], dataset: pub.fn, ok: close(st['Fundamental Frequency'], pub.fn) });
      checks.push({ state: k, field: 'EC', solver: st['Embodied Carbon Scaled'] / LB_TO_KG, dataset: pub.ec_lb_ft2, ok: close(st['Embodied Carbon Scaled'] / LB_TO_KG, pub.ec_lb_ft2) });
      if (pub.infill_studs !== undefined && Number.isFinite(st['Infill Studs'])) checks.push({ state: k, field: 'infill studs', solver: st['Infill Studs'], dataset: pub.infill_studs, ok: st['Infill Studs'] === pub.infill_studs });
      if (pub.girder_studs !== undefined && Number.isFinite(st['Girder Studs'])) checks.push({ state: k, field: 'girder studs', solver: st['Girder Studs'], dataset: pub.girder_studs, ok: st['Girder Studs'] === pub.girder_studs });
    }
    const methodOk = d.get('method_raw', row) === res.condition_class;
    checks.push({ state: 'best', field: 'method code', solver: res.condition_class, dataset: d.get('method_raw', row), ok: methodOk });
    res._match = { row, checks, n: checks.length, nOk: checks.filter(c => c.ok).length };
  }

  // ------------------------------------------------------------------ model for the 3D view
  function modelFor(res, key) {
    const cap = res.captured[key];
    if (!cap) return null;
    const v = cap.values;
    const st = res.states[key];
    const iname = key === 'check' ? res.request.infill_shape : st['Infill Sizes'];
    const gname = key === 'check' ? res.request.girder_shape : st['Girder Sizes'];
    const comp = res.system === 'composite';
    return {
      composite: comp, Lg: v.Girder_Span, Lj: v.Infill_Span, N: v.NumInfill, s: v.infill_spacing, hr: v.Deck_Type,
      tc: v.selected_deck_topping_thickness, add: v.Additional_Topping || 0, deckLabel: v.selected_deck,
      infill: { name: iname, dims: shapes.byName[iname], studs: comp ? v.min_req_studs_II : 0, perRib: comp ? v.min_studs_per_rib_II || 1 : 1, camber: comp ? v.camber_II : 0 },
      girder: { name: gname, dims: shapes.byName[gname], studs: comp ? v.min_req_studs_IG : 0, perRib: comp ? v.min_studs_per_rib_IG || 1 : 1, camber: comp ? v.camber_IG : 0 },
      vib: { dj: v.DEF_j, dg: v.DEF_g, dgr: v.DEF_g_reduced, fn: v.fn, fj: v.fj, fg: v.fg, ap: v.peak_acceleration, limit: v.tolerance_limit, Bj: v.Bj, Bg: v.Bg, beta: v.damping_ratio ?? v.DR },
    };
  }

  function sel() { return result?.captured?.[S.view] ? S.view : null; }

  function stateSummary(res, key) {
    if (key === 'check') {
      const v = res.captured.check?.values || {};
      return { infill: res.request.infill_shape, girder: res.request.girder_shape, pa: v.peak_acceleration, fn: v.fn, ec: v.EC_scaled, applies: true };
    }
    const st = res.states[key];
    return { infill: st['Infill Sizes'], girder: st['Girder Sizes'], pa: st['Peak Acceleration'], fn: st['Fundamental Frequency'], ec: st['Embodied Carbon Scaled'], applies: st._applies, add: st['Additional Topping'], upsizes: st['# of Upsizes'] };
  }

  // ------------------------------------------------------------------ rendering
  function renderAll() {
    syncInputs();
    renderResults();
    renderTools();
    renderHud();
    renderAnalysis();
    const k = sel();
    if (result?.ok && k && shapes) {
      const m = modelFor(result, k);
      if (m && m.infill.dims && m.girder.dims) bay.setModel(m);
    }
  }

  function renderResults() {
    const out = $('#dOut', root);
    if (!result) return;
    renderQuick();
    if (!result.ok) {
      out.innerHTML = `<div class="verdict"><h3>No design for these inputs</h3><p class="muted small" style="margin:8px 0 0">${esc(result.error || '')}</p>
        <p class="small">The solver could not size a deck or members that pass every check.${nInf() || slabT() ? ' With your own beam count or slab depth, the deck table may have no deck that spans that far or carries that slab — try Auto, more beams or another depth.' : ' Try a shorter span, a deeper deck or less composite action.'}</p></div>`;
      return;
    }
    const key = sel();
    const res = result;
    const summ = stateSummary(res, key);
    const cap = res.captured[key];
    const v = cap.values;
    const limit = v.tolerance_limit ?? 0.5;
    const pass = summ.pa <= limit;
    const ec = ecFromSolver(summ.ec);
    const ec0 = res.states.initial?._applies ? res.states.initial['Embodied Carbon Scaled'] : null;
    const dEc = ec0 && key !== 'initial' ? (summ.ec / ec0 - 1) * 100 : null;
    const gmax = Math.max(limit * 3, summ.pa * 1.1);
    const method = res.condition_class;
    const methodTxt = METHOD_LABELS[method] || res.method;
    const steelPsf = v.steel_w / v.bay_area;
    const structural = calcInfo[res.system] ? C.structuralPass(calcInfo[res.system], v) : null;

    let html = `<div class="verdict fade-in">
      <div class="v-top"><div><div class="tiny muted">${res.system === 'composite' ? 'Composite' : 'Non-composite'} · ${S.mode === 'check' ? 'your design' : 'optimized by the paper\'s solver'}</div>
      <h3>${esc(STATE_SHORT[key])}${key === 'best' ? ' <span class="star">★</span>' : ''}</h3></div>
      ${pass ? '<span class="pill pass">✓ meets 0.5 %g</span>' : '<span class="pill fail">✗ exceeds limit</span>'}</div>
      ${res.variant ? `<div class="warn-box" style="margin-top:8px"><b>Set by you</b> — ${esc(res.variant.note)}${res.variant.member && Object.keys(res.variant.member).length ? ' Your camber and studs apply to your members only; the optimizer’s states use the solver’s own values.' : ''}</div>` : ''}
      ${S.mode === 'optimize' ? `<div class="small" style="margin-top:6px;color:var(--text2)">Lowest-carbon fix chosen by the solver: <b style="color:${METHOD_COLORS[method]}">${esc(methodTxt)}</b></div>` : ''}
      ${S.mode === 'check' && key === 'check' ? (() => {
        const f = calcInfo[res.system] ? C.failingChecks(calcInfo[res.system], v) : { structural: [], filters: [] };
        return `<div class="small" style="margin-top:6px">Strength and deflection: ${structural ? '<span class="pill pass">all pass</span>' : `<span class="pill fail">${f.structural.length} fail</span> <span style="color:var(--text2)">${esc(f.structural.join(' · '))}</span>`}</div>` +
          (f.filters.length ? `<div class="tiny muted" style="margin-top:4px">Not a structural failure: ${esc(f.filters.join('; ').toLowerCase())} — the optimizer would not have picked this pair.</div>` : '');
      })() : ''}
      <div class="gauge" title="Peak acceleration vs the 0.5 %g tolerance limit (AISC DG 11)">
        <div class="gauge-track"><div class="gauge-limit" style="left:${limit / gmax * 100}%"></div><div class="gauge-mark" style="left:calc(${Math.min(100, summ.pa / gmax * 100)}% - 1px)"></div></div>
        <div class="gauge-lab"><span>0</span><span>limit ${limit} %g</span><span>${fmt(gmax, 2)} %g</span></div></div>
      <div class="kpis">
        <div class="kpi"><div class="k-l">Peak acceleration</div><div class="k-v">${fmtFixed(summ.pa, 3)}<span class="k-u">%g</span></div><div class="k-s">${fmtFixed(summ.pa / limit, 2)} × limit</div></div>
        <div class="kpi"><div class="k-l">Floor frequency</div><div class="k-v">${fmtFixed(summ.fn, 2)}<span class="k-u">Hz</span></div><div class="k-s">f<sub>j</sub> ${fmtFixed(v.fj, 2)} · f<sub>g</sub> ${fmtFixed(v.fg, 2)}</div></div>
        <div class="kpi"><div class="k-l">Embodied carbon</div><div class="k-v">${fmtFixed(ec.v, 2)}<span class="k-u">${ec.u}</span></div><div class="k-s">${dEc === null ? ecBay(v.EC) + ' per bay' : `${dEc >= 0 ? '+' : ''}${fmtFixed(dEc, 1)} % carbon vs ${key === 'check' ? "optimizer's initial" : 'initial'}`}</div></div>
        <div class="kpi"><div class="k-l">Steel</div><div class="k-v">${fmtFixed(getUnits() === 'si' ? steelPsf * 4.8824 : steelPsf, getUnits() === 'si' ? 1 : 2)}<span class="k-u">${getUnits() === 'si' ? 'kg/m²' : 'psf'}</span></div><div class="k-s">${v.NumInfill} interior infills @ ${len.ft(v.infill_spacing, 2)}</div></div>
      </div></div>`;

    // design states
    html += `<div class="card" style="margin-top:12px"><div class="card-h">Design states <span class="sub">click to view</span></div><div class="card-b" style="padding-top:8px"><div class="states">`;
    const keys = S.mode === 'check' ? ['check', ...STATE_KEYS] : STATE_KEYS;
    for (const k of keys) {
      const ss = stateSummary(res, k);
      const na = !ss.applies || !res.captured[k];
      const why = na ? (k !== 'best' && res.states.initial?.['Peak Acceleration'] <= limit ? 'not needed — passes as built' : 'no passing design on this path') : '';
      const e = ecFromSolver(ss.ec);
      const stillFails = !na && k !== 'initial' && k !== 'check' && ss.pa > limit;
      const tipTxt = { initial: 'Sized for strength and deflection only, before any vibration mitigation', best: 'The lowest-carbon design that meets 0.5 %g', check: 'The infill and girder you picked, checked with the solver' }[k] || 'One mitigation path the solver tried';
      html += `<button class="state${k === key ? ' on' : ''}${na ? ' na' : ''}" data-st="${k}" ${na ? 'disabled' : ''} title="${tipTxt}">
        <span class="s-name"><span class="dot" style="color:${STATE_COLOR[k]}"></span>${esc(STATE_SHORT[k])}${k === 'best' ? ' <span class="star">★</span>' : ''}${!na && ss.pa <= limit ? '' : ''}</span>
        <span class="s-val">${na ? '' : `<b style="color:${ss.pa <= limit ? 'var(--pass)' : 'var(--fail)'}">${fmtFixed(ss.pa, 3)} %g</b>${fmtFixed(e.v, 2)} <span class="muted">${e.u}</span>`}</span>
        <span class="s-mem">${na ? `<span class="muted" style="font-family:var(--font)">${why}</span>` : `<span class="muted" style="font-family:var(--font)">infill</span> ${esc(ss.infill)} <span class="muted" style="font-family:var(--font)">girder</span> ${esc(ss.girder)}${ss.add ? ` · +${ss.add}" topping` : ''}${ss.upsizes ? ` · ${ss.upsizes} upsizes` : ''}${stillFails ? '<br><span style="color:var(--fail);font-family:var(--font)">✗ ran out of larger shapes — still above the limit</span>' : ''}`}</span>
      </button>`;
    }
    html += `</div></div></div>`;

    // mitigation trade-off chart (interactive; drawn after the panel is in the page)
    html += `<div class="card" style="margin-top:12px"><div class="card-h">Mitigation trade-off <span class="sub">hover · click a state</span>
      <button class="icon-btn sm" id="toBig" title="Open a large, interactive view" aria-label="Enlarge the chart"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M4 4h6v2H7.4l4 4L10 11.4l-4-4V10H4V4Zm16 0v6h-2V7.4l-4 4L12.6 10l4-4H14V4h6ZM4 20v-6h2v2.6l4-4 1.4 1.4-4 4H10v2H4Zm16 0h-6v-2h2.6l-4-4 1.4-1.4 4 4V14h2v6Z"/></svg></button></div>
      <div class="card-b"><div class="chart-box" id="toChart"></div></div></div>`;

    // carbon split
    if (calcInfo[res.system]) {
      const sp = C.carbonSplit(cap, calcInfo[res.system]);
      html += `<div class="card" style="margin-top:12px"><div class="card-h">Where the carbon is <span class="sub">${ecBay(v.EC)} per bay</span></div><div class="card-b">
        <div class="chart-box">${stackedBar(sp.parts.map(p => ({ label: p.label, value: p.kg, color: p.color })))}</div>
        <div class="legend">${sp.parts.map(p => `<span><i style="background:${p.color}"></i>${p.label} ${fmt(100 * p.kg / sp.sum, 1)}%</span>`).join('')}</div>
        <div class="tiny muted" style="margin-top:6px">${sp.ok ? '<span class="ok-ic">✓</span> parts sum to the solver\'s EC' : '<span class="bad-ic">✗</span> parts do not sum to EC'} · factors from the solver's EC line</div></div></div>`;
    }

    // members
    const m = modelFor(res, key);
    const memRow = (lab, mm) => {
      const d = shapes.byName[mm.name] || {};
      return `<tr><td>${lab}</td><td><b class="mono">${esc(mm.name)}</b><div class="tiny muted">d ${d.d}" · b<sub>f</sub> ${d.bf}" · t<sub>f</sub> ${d.tf}" · t<sub>w</sub> ${d.tw}" · ${d.W} lb/ft</div>
        ${res.system === 'composite' ? `<div class="tiny">${fmt(mm.studs, 0)} studs (¾" × ${m.hr + 1.5}")${mm.perRib > 1 ? (lab === 'Girders' ? `, ${mm.perRib} side by side` : `, ${mm.perRib} per rib`) : ''}${mm.camber ? ` · camber ${mm.camber}"` : ' · no camber'}</div>` : ''}</td></tr>`;
    };
    html += `<div class="card" style="margin-top:12px"><div class="card-h">Members and slab</div><div class="card-b"><table class="member-table">
      ${memRow('Infill beams', m.infill)}${memRow('Girders', m.girder)}
      <tr><td>Deck</td><td>${esc(v.selected_deck || '')}<div class="tiny muted">deck ${fmt(v.selected_deck_SW, 2)} psf · slab ${fmt(v.Final_Slab_SW, 1)} psf</div></td></tr>
      <tr><td>Slab</td><td><b>${fmt(v.Deck_Type + v.selected_deck_topping_thickness + (v.Additional_Topping || 0), 2)}" total</b> = ${v.Deck_Type}" ribs + ${fmt(v.selected_deck_topping_thickness, 2)}" above${v.Additional_Topping ? ` + ${v.Additional_Topping}" added topping` : ''} · ${v.Conc_Type === 'LW' ? 'lightweight' : 'normal-weight'}</td></tr>
      <tr><td>Framing</td><td>${v.NumInfill} interior infills at ${fmt(v.infill_spacing, 3)} ft</td></tr></table></div></div>`;

    // validation summary
    html += validationCard(res, key);

    if (res.warnings?.length) html += `<div class="warn-box"><b>Note</b> — ${res.warnings.map(esc).join(' ')}</div>`;

    html += `<div class="row" style="margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-primary" id="repBtn">Calc report</button>
      <button class="btn" id="engBtn" data-goto-tab="valid" title="Validation, every captured engine variable and the solver source">Engine details</button>
      <button class="btn" id="shareBtn" title="Copy a link to this design">Copy link</button>
      <button class="btn btn-ghost" id="jsonBtn" title="Every captured value as JSON">JSON</button></div>
      <div class="tiny muted" style="margin-top:10px">Engine: <code>${esc(res.engine.notebook)}</code> solver cell, SHA-256 ${esc(res.engine.solver_cell_sha256.slice(0, 12))}… · Python ${esc(res.engine.python)}, numpy ${esc(res.engine.numpy)}, pandas ${esc(res.engine.pandas)}</div>`;

    const calcCard = calcInfo[res.system] ? `<div class="card calc-card"><div class="card-h">Calculations <span class="sub">${esc(STATE_SHORT[key])} · open any line for the calc</span></div><div class="card-b" id="calcBody"></div></div>` : '';
    out.innerHTML = `<div class="stale-dim">${calcCard}${html}</div>`;
    if (calcCard) {
      calcApi = mountCalcs($('#calcBody', out), {
        ci: calcInfo[res.system], cap, mode: S.mode, state: calcState,
        onSource: (line) => { tab = 'source'; srcLine = line; store.set('anTab', tab); openAnalysis(); },
        onMissingVar: (nm) => jumpVar(nm),
      });
    }
    drawTradeoff($('#toChart', out), res, key, SMALL);
    $('#toBig', out).onclick = () => openTradeoff();
    renderAssume();
    $$('.state', out).forEach(b => b.onclick = () => { if (b.disabled) return; S.view = b.dataset.st; writeHash(); renderAll(); });
    $('#repBtn', out).onclick = () => {
      // screenshots straight from the 3D view, each set up for the story it tells
      const views = bay.captureViews([
        { key: 'hero', view: 'iso', zoom: 0.72, floor: 'accel', layers: { labels: true, dims: true, panels: false }, title: '3D view, coloured by DG 11 peak acceleration' },
        { key: 'plan', view: 'top', zoom: 0.8, floor: 'concrete', layers: { labels: true, dims: true, panels: false, xray: true }, title: 'Plan: framing, members and dimensions' },
        { key: 'section', view: 'section', floor: 'concrete', layers: { labels: false, dims: false, panels: false }, title: 'Section through the slab, deck and girder at mid-span' },
        { key: 'panels', view: 'top', zoom: 0.8, floor: 'mode', layers: { labels: true, dims: false, panels: true }, title: 'DG 11 mode shape with the effective panel widths B_j and B_g' },
        { key: 'under', view: 'under', floor: 'concrete', layers: { labels: false, dims: false, panels: false, xray: false }, title: 'Underside: deck ribs, studs and connections' },
      ]);
      openReport({ result, key: sel(), calcInfo: calcInfo[result.system], shapes, views, model: modelFor(result, sel()) });
    };
    $('#shareBtn', out).onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied — it reopens this exact design.'); } catch { toast(location.href); } };
    $('#jsonBtn', out).onclick = () => downloadText(`bay_${result.system}_${S.g}x${S.i}.json`, JSON.stringify(result, null, 1), 'application/json');
    $$('[data-goto-tab]', out).forEach(b => b.onclick = () => { tab = b.dataset.gotoTab; store.set('anTab', tab); openAnalysis(); });
  }

  // ------------------------------------------------------------------ quick result card
  // Compact summary at the top of the inputs. CSS shows it only where the results panel is a drawer or below
  // the fold (≤ 1100 px), so the verdict stays in view while the inputs change.
  function renderQuick() {
    const q = $('#quick', root);
    if (!q || !result) return;
    q.hidden = false;
    const open = `<button type="button" class="btn btn-sm btn-ghost q-open" id="qOpen">Results ▸</button>`;
    if (!result.ok) {
      q.innerHTML = `<div class="q-top"><b>No design for these inputs</b><span class="pill fail">✗ no design</span></div>${open}`;
    } else {
      const key = sel();
      const summ = stateSummary(result, key);
      const v = result.captured[key].values;
      const limit = v.tolerance_limit ?? 0.5;
      const pass = summ.pa <= limit;
      const ec = ecFromSolver(summ.ec);
      q.innerHTML = `
        <div class="q-top"><b>${esc(STATE_SHORT[key])}${key === 'best' ? ' <span class="star">★</span>' : ''}</b>
          ${pass ? '<span class="pill pass">✓ meets 0.5 %g</span>' : '<span class="pill fail">✗ exceeds limit</span>'}</div>
        <dl class="q-kpis">
          <div><dt>Peak accel.</dt><dd><b style="color:${pass ? 'var(--pass)' : 'var(--fail)'}">${fmtFixed(summ.pa, 3)}</b> %g <span class="muted">· ${fmtFixed(summ.pa / limit, 2)}×</span></dd></div>
          <div><dt>Frequency</dt><dd><b>${fmtFixed(summ.fn, 2)}</b> Hz</dd></div>
          <div><dt>Carbon</dt><dd><b>${fmtFixed(ec.v, 2)}</b> ${ec.u}</dd></div>
        </dl>
        <div class="q-mem"><span class="muted">infill</span> ${esc(summ.infill)} <span class="muted">girder</span> ${esc(summ.girder)}${summ.add ? ` · +${summ.add}" topping` : ''}</div>
        ${result.variant ? '<div class="q-note">Includes values set by you.</div>' : ''}${open}`;
    }
    $('#qOpen', q).onclick = () => {
      if (window.innerWidth <= 640) $('#dOut', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
      else { root.querySelector('.designer').classList.add('show-side'); renderTools(); }
    };
  }

  // ------------------------------------------------------------------ mitigation trade-off chart
  const chartHidden = new Set();
  const SMALL = { width: 380, height: 260 }, BIG = { width: 1000, height: 560 };
  function tradeSeries(res, key) {
    const limit = res.captured[key]?.values?.tolerance_limit ?? 0.5;
    const keys = S.mode === 'check' ? ['check', ...STATE_KEYS] : STATE_KEYS;
    const ecTxt = (ec) => { const e = ecFromSolver(ec); return `${fmtFixed(e.v, 2)} ${e.u}`; };
    const paTxt = (pa) => `<b style="color:${pa <= limit ? 'var(--pass)' : 'var(--fail)'}">${fmtFixed(pa, 3)} %g</b>`;
    const series = [];
    const init = res.states.initial;
    for (const k of ['infill', 'girder', 'conc']) {
      const p = res.states[k]?._path;
      if (!p || p.length < 2 || !init?._applies) continue;
      const step = (q, i) => ({
        x: q['Peak Acceleration'], y: ecFromSolver(q['Embodied Carbon Scaled']).v,
        tip: `<b style="color:${STATE_COLOR[k]}">${esc(STATE_SHORT[k])}</b> <span class="tt-s">step ${i} of ${p.length}</span>
          <div>${esc(q['Infill Sizes'])} / ${esc(q['Girder Sizes'])}${q['Additional Topping'] ? ` · +${q['Additional Topping']}" topping` : ''}</div>
          <div>${paTxt(q['Peak Acceleration'])} · ${ecTxt(q['Embodied Carbon Scaled'])}</div>`,
      });
      series.push({
        name: STATE_SHORT[k], color: STATE_COLOR[k], line: true, size: 2.4, dash: k === 'conc' ? '4 3' : null, legend: false,
        points: [{ x: init['Peak Acceleration'], y: ecFromSolver(init['Embodied Carbon Scaled']).v,
          tip: `<b>Initial design</b><div>${esc(init['Infill Sizes'])} / ${esc(init['Girder Sizes'])}</div><div>${paTxt(init['Peak Acceleration'])} · ${ecTxt(init['Embodied Carbon Scaled'])}</div>` },
        ...p.map((q, i) => step(q, i + 1))],
      });
    }
    // upsizing infills and girders together is not a step-by-step path: the solver searches every infill x girder
    // pair at once and keeps the lowest-carbon one that passes. Drawn as one dashed jump from the initial design.
    const st = res.states.steel;
    if (st?._applies && init?._applies) {
      const tipS = `<b style="color:${STATE_COLOR.steel}">${esc(STATE_SHORT.steel)}</b> <span class="tt-s">one jump</span><div>The solver searches every infill × girder pair and keeps the lowest-carbon pair that passes.</div>`;
      series.push({
        name: STATE_SHORT.steel, color: STATE_COLOR.steel, line: true, size: 0.1, dash: '8 5', legend: false,
        points: [{ x: init['Peak Acceleration'], y: ecFromSolver(init['Embodied Carbon Scaled']).v, tip: tipS },
          { x: st['Peak Acceleration'], y: ecFromSolver(st['Embodied Carbon Scaled']).v, tip: tipS }],
      });
    }
    // a state on top of another (best is usually one of the paths' end points): draw best first, larger, as a halo
    const same = (a, b) => { const A = stateSummary(res, a), B = stateSummary(res, b); return A.applies && B.applies && A.pa === B.pa && A.ec === B.ec; };
    const bestOn = STATE_KEYS.filter(k => k !== 'best' && k !== 'initial' && same('best', k));
    const order = bestOn.length ? ['best', ...keys.filter(k => k !== 'best')] : keys;
    for (const k of order) {
      const ss = stateSummary(res, k);
      if (!ss.applies || !res.captured[k]) continue;
      const col = k === 'check' ? 'var(--text)' : STATE_COLOR[k];
      const halo = k === 'best' && bestOn.length;
      series.push({ name: STATE_SHORT[k], color: col, points: [{
        x: ss.pa, y: ecFromSolver(ss.ec).v, ring: k === key, size: halo ? 10 : k === key ? 6.5 : 5, key: k,
        tip: `<b style="color:${col}">${esc(STATE_SHORT[k])}</b>${k === 'best' ? ' ★' : ''}${halo ? ` <span class="tt-s">= ${bestOn.map(b => esc(STATE_SHORT[b])).join(', ')}</span>` : ''}${k === key ? ' <span class="tt-s">· shown</span>' : ''}
          <div>${esc(ss.infill)} / ${esc(ss.girder)}${ss.add ? ` · +${ss.add}" topping` : ''}</div>
          <div>${paTxt(ss.pa)} · ${ecTxt(ss.ec)}</div>${k === key ? '' : '<div class="tt-s">click to view this state</div>'}` }] });
    }
    return { series, limit };
  }
  function drawTradeoff(el, res, key, size) {
    if (!el) return;
    const { series, limit } = tradeSeries(res, key);
    interactiveScatter(el, {
      series, ...size, hidden: chartHidden, xLabel: 'Peak acceleration (%g)', yLabel: `EC (${ecUnit()})`,
      xLine: limit, xLineLabel: `${limit} %g`, xMin: 0,
      onPick: (k) => {
        if (k === S.view || !result?.captured?.[k]) return;
        S.view = k; writeHash(); renderAll();
        const big = document.getElementById('toDlg');
        if (big?.open) drawTradeoff($('#toBigChart', big), result, k, BIG);
      },
      onToggle: () => { if (result?.ok) drawTradeoff($('#toChart', root), result, sel(), SMALL); },
    });
  }
  function openTradeoff() {
    let dlg = document.getElementById('toDlg');
    if (!dlg) {
      dlg = h('dialog', { class: 'dlg chart-dlg', id: 'toDlg' });
      dlg.innerHTML = `<div class="dlg-body"><div class="row" style="margin-bottom:6px"><h2 style="margin:0">Mitigation trade-off</h2><span class="spacer"></span>
        <button class="icon-btn" id="toClose" aria-label="Close">✕</button></div>
        <div class="small muted" style="margin-bottom:8px">Each line is one mitigation path the solver tried, step by step from the initial design; the large dots are the design states. Upsizing infills and girders together is a single search over every pair, so it is drawn as one long-dashed blue jump. When the best design is one of the other states, it is the green halo around that state's dot. Hover for members, peak acceleration and carbon; click a state to show it in the app; click a legend entry to hide or show it. The shaded band is above the tolerance limit.</div>
        <div class="chart-box" id="toBigChart"></div></div>`;
      document.body.append(dlg);
      $('#toClose', dlg).onclick = () => dlg.close();
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }
    dlg.showModal();
    drawTradeoff($('#toBigChart', dlg), result, sel(), BIG);
  }

  function validationCard(res, key) {
    const cap = res.captured[key];
    const va = cap.validation, rc = cap.recheck;
    const sp = calcInfo[res.system] ? C.carbonSplit(cap, calcInfo[res.system]) : null;
    const mt = res._match;
    const line = (ok, txt) => `<div class="row small" style="margin:3px 0"><span class="${ok === null ? 'skip-ic' : ok ? 'ok-ic' : 'bad-ic'}">${ok === null ? '·' : ok ? '✓' : '✗'}</span><span>${txt}</span></div>`;
    let html = `<div class="card" style="margin-top:12px"><div class="card-h">Validation <span class="sub">is the tool showing the solver's numbers?</span></div><div class="card-b">`;
    if (va) html += line(va.all_ok, `<b>${va.n_ok}/${va.n}</b> reported outputs reproduced from captured internals${va.n_known_quirk ? ` (+${va.n_known_quirk} known reporting quirk)` : ''}`);
    if (rc) html += line(rc.n_bad === 0, `<b>${rc.n_ok}</b> solver lines re-run at this pair reproduce their values${rc.n_bad ? `, <b>${rc.n_bad}</b> differ` : ''}`);
    if (sp) html += line(sp.ok, 'carbon parts sum to the solver\'s EC');
    if (mt) html += line(mt.nOk === mt.n, `<b>${mt.nOk}/${mt.n}</b> values of the optimizer's states match the published dataset (row ${mt.row + 1})${key === 'check' ? ' — your own pair is not in the dataset' : ''}`);
    else html += line(null, 'published dataset: these inputs are outside the paper\'s grid');
    html += `<button class="btn btn-sm btn-ghost" data-goto-tab="valid" style="margin-top:6px">Details</button></div></div>`;
    return html;
  }

  // ------------------------------------------------------------------ fixed assumptions (not inputs)
  function renderAssume() {
    const el = $('#assume', root);
    const k = sel();
    if (!el) return;
    if (!result?.ok || !k) { el.innerHTML = ''; return; }
    const v = result.captured[k].values;
    const comp = result.system === 'composite';
    const lw = v.Conc_Type === 'LW';
    const mo = {};
    if (k === 'check') for (const f of Object.values(MEMBER_OVR)) if (result.request?.[f] !== null && result.request?.[f] !== undefined) mo[f] = result.request[f];
    const mine = (f) => (mo[f] === undefined ? '' : ' <b style="color:var(--warn)">(set by you)</b>');
    const useName = (window.__msveMeta?.systems?.[result.system]?.building_uses?.[result.request?.building_use] || [])[0] || 'occupancy';   // the solved request, not the live input
    // where each value comes from: an input of the published sizer_and_calc (or the app's override), or a constant in its code
    const IN = (t) => `<span class="src in">input: ${t}</span>`;
    const FX = (t) => `<span class="src fx">${t}</span>`;
    const userStuds = mo.studs_infill !== undefined || mo.studs_girder !== undefined;
    const userCamber = mo.camber_infill !== undefined || mo.camber_girder !== undefined;
    const rows = [
      ['Infill spacing', `${fmt(v.infill_spacing, 3)} ft (${v.NumInfill} interior infills)`,
        nInf() ? IN('Beams between girders (set by you)')
          : FX(`solver's rule: widest spacing the deck table allows${S.mode === 'check' ? ' (Auto)' : '; set your own in Custom design'}`)],
      ['Deck / slab', `${esc(v.selected_deck)}; ${fmt(v.Deck_Type + v.selected_deck_topping_thickness + (v.Additional_Topping || 0), 2)} in total depth`,
        IN(`Deck rib depth, Concrete${slabT() ? ', Total slab depth (set by you)' : ''}`)
          + (slabT() ? '' : ' ' + FX(`depth: lightest that works${S.mode === 'check' ? ' (Auto)' : '; set your own in Custom design'}`))],
      comp ? ['Studs', `¾ in, F<sub>u</sub> = 65 ksi; infill ${fmt(v.min_req_studs_II, 0)}${mine('studs_infill')}, girder ${fmt(v.min_req_studs_IG, 0)}${mine('studs_girder')}`,
        userStuds ? IN('Camber and studs (Custom design)') : IN('Degree of composite action (the solver sizes the studs to reach it)') + ' ' + FX('stud size and F<sub>u</sub> fixed in the code')] : null,
      ['Materials', `F<sub>y</sub> = ${v.Fy} ksi, E<sub>s</sub> = ${fmt(v.Es, 0)} ksi, f'<sub>c</sub> = ${v.f_prime_c} ksi, ${lw ? 'LWC 110' : 'NWC 145'} pcf`,
        IN('Concrete (density)') + ' ' + FX('F<sub>y</sub>, E<sub>s</sub>, f\'<sub>c</sub> fixed in the code')],
      ['Loads', `LL ${v.LL} psf, SDL ${v.SDL} psf, construction LL 20 psf; LRFD 1.4D and 1.2D + 1.6L`,
        IN(`Occupancy (${esc(useName)} → LL ${v.LL} psf)`) + ' ' + FX('SDL, construction LL and load combinations fixed in the code')],
      ['Construction', comp ? `unshored: bare steel carries the wet concrete; camber ${userCamber ? `infill ${fmt(v.camber_II, 2)} in${mine('camber_infill')}, girder ${fmt(v.camber_IG, 2)} in${mine('camber_girder')}` : '0.8 × construction deflection (¼ in steps, spans ≥ 24 ft)'}` : 'non-composite beams; deck braces the infill top flange',
        comp && userCamber ? IN('Camber and studs (Custom design)') : FX(comp ? 'camber rule fixed in the code; set your own in Custom design' : 'fixed in the code')],
      ['Vibration (DG 11)', `vibration LL ${v.live_load_vibrations} psf + ${fmt(v.dead_load, 0)} psf; β = ${v.DR}; limit ${v.tolerance_limit} %g; W<sub>j</sub> × 1.5 (continuous infills)`,
        IN(`Occupancy (vibration LL, β, limit from the DG 11 table)`) + ' ' + FX(`${fmt(v.dead_load, 0)} psf vibration dead load and W<sub>j</sub> × 1.5 fixed in the code`)],
    ].filter(Boolean);
    const body = `<table>${rows.map(([a, b, src]) => `<tr><td>${a}</td><td>${b}<div class="src-row">${src}</div></td></tr>`).join('')}</table>
      <div class="tiny muted" style="margin-top:6px">Loads come from the occupancy, through the published solver's own table (as in the paper), not from free load inputs.</div>`;
    const title = 'Design basis <span class="muted" style="font-weight:500">· what each value comes from</span>';
    el.innerHTML = S.mode === 'check'
      ? `<div class="assume"><div class="field-label" style="margin-bottom:4px"><span>${title}</span></div>${body}</div>`
      : `<details class="assume"><summary class="small" style="cursor:pointer;font-weight:600;color:var(--text2)">${title}</summary>${body}</details>`;
  }

  // ------------------------------------------------------------------ viewport tools + HUD
  function renderTools() {
    const tb = $('#vpTools', root);
    const L = bay.layers;
    const grp = (lab, items, cur, attr) => `<div class="vp-group"><span class="lab">${lab}</span>${items.map(([v, t, title]) => `<button data-${attr}="${v}" class="${(typeof cur === 'function' ? cur(v) : cur === v) ? 'on' : ''}" title="${esc(title || t)}">${t}</button>`).join('')}</div>`;
    tb.innerHTML =
      `<div class="vp-group side-toggle"><button id="sideBtn" class="${root.querySelector('.designer').classList.contains('show-side') ? 'on' : ''}" title="Show or hide the results panel">Results ◂</button></div>` +
      grp('Overlay', [['concrete', 'None', 'No colour overlay: see-through concrete'], ['mode', 'Mode shape', 'DG 11 combined mode φ(x, z) from Δj and Δg'], ['accel', 'Peak accel.', 'a_p × φ: DG 11 peak acceleration distributed by the mode shape, with the 0.5 %g contour'], ['defl', 'Deflection', 'DG 11 static deflection Δj + Δg shaped by φ']], bay.floorMode, 'floor') +
      grp('Motion', [['still', 'Still'], ['vibrate', 'Vibrate', 'Animate the floor at its frequency fn (slowed)'], ['walk', 'Walk test', 'A walker crosses the bay, steps off onto the adjacent floor and waits while the response decays. The Peak accel. colours follow them: DG 11 a_p × φ at the walker × φ, building up and decaying as 1 − e^(−t/τ), τ = 1/(2πβfn); the steady value at mid-bay is the solver\'s a_p.']], bay.motion, 'motion') +
      grp('View', [['iso', '3D'], ['top', 'Plan'], ['section', 'Section', 'Cut through the slab, deck and girders'], ['under', 'Below', 'Underside: deck ribs and studs'], ['close', 'Close-up', 'Corner close-up of the connection and studs']], bay.view, 'view') +
      grp('Show', [['slab', 'Slab'], ['deck', 'Deck'], ['studs', 'Studs'], ['panels', 'Bj / Bg', 'DG 11 effective panel widths and the neighbouring bays'], ['xray', 'X-ray', 'See-through slab and deck'], ['labels', 'Labels'], ['dims', 'Dims'], ['columns', 'Columns']], (v) => L[v], 'layer');
    $('#sideBtn', tb).onclick = () => { root.querySelector('.designer').classList.toggle('show-side'); renderTools(); };
    $$('[data-floor]', tb).forEach(b => b.onclick = () => { bay.setFloorMode(b.dataset.floor); renderTools(); renderHud(); });
    $$('[data-motion]', tb).forEach(b => b.onclick = () => { bay.setMotion(b.dataset.motion); walk = null; renderTools(); renderHud(); });
    $$('[data-view]', tb).forEach(b => b.onclick = () => { bay.setView(b.dataset.view); renderTools(); });
    $$('[data-layer]', tb).forEach(b => b.onclick = () => { bay.setLayer(b.dataset.layer, !bay.layers[b.dataset.layer]); renderTools(); });

    $('#vpBottom', root).innerHTML = `
      <label class="vp-slider" title="Visual exaggeration of the DG 11 deflection">Deflection ×<input type="range" id="exSl" min="0" max="60" step="1" value="${bay.exag}"><b id="exV">${bay.exag}</b></label>
      <label class="vp-slider" title="Slow motion factor for the vibration animation">Speed<input type="range" id="slSl" min="0.03" max="1" step="0.01" value="${bay.slow}"><b id="slV">${fmt(bay.slow, 2)}×</b></label>
      <label class="vp-slider" title="Section cut position along the girders">Cut<input type="range" id="cutSl" min="0" max="0.98" step="0.01" value="${bay.cut}"></label>
      ${bay.motion === 'walk' ? `<label class="vp-slider" title="Walking pace (DG 11 considers 1.6–2.2 Hz)">Pace<input type="range" id="stSl" min="1.6" max="2.2" step="0.05" value="${bay.stepHz}"><b id="stV">${fmt(bay.stepHz, 2)} Hz</b></label>` : ''}
      <span class="vp-hint">Click the floor to stomp · drag to orbit · scroll to zoom</span>`;
    $('#exSl', root).oninput = (e) => { bay.setExaggeration(+e.target.value); $('#exV', root).textContent = e.target.value; };
    $('#slSl', root).oninput = (e) => { bay.setSlow(+e.target.value); $('#slV', root).textContent = fmt(+e.target.value, 2) + '×'; };
    $('#cutSl', root).oninput = (e) => bay.setSection(+e.target.value);
    const st = $('#stSl', root);
    if (st) st.oninput = (e) => { bay.setStepHz(+e.target.value); $('#stV', root).textContent = fmt(+e.target.value, 2) + ' Hz'; };
  }

  function renderHud() {
    const hud = $('#vpHud', root);
    const k = sel();
    if (!result?.ok || !k) { hud.innerHTML = ''; return; }
    const v = result.captured[k].values;
    const lim = v.tolerance_limit ?? 0.5, ap = v.peak_acceleration;
    const mode = bay.floorMode;
    let bar = '';
    if (mode === 'mode') bar = `<div class="hud-title">Mode shape φ</div><div class="colorbar"></div><div class="colorbar-ticks"><span>0</span><span>0.5</span><span>1.0</span></div>`;
    else if (mode === 'accel') {
      const vmax = Math.max(ap, 2 * lim);
      const f = lim / vmax * 100;
      const grad = `linear-gradient(90deg, #4178BE 0%, #85C1E9 ${0.2667 * f}%, #A3B376 ${0.5333 * f}%, #FCAE2E ${0.8 * f}%, #D62626 ${f}%, #3A0303 100%)`;
      bar = `<div class="hud-title">a<sub>p</sub> × φ (%g) · red at the limit, darker above</div><div class="colorbar" style="background:${grad}"><div class="limit-tick" style="left:${lim / vmax * 100}%"></div><div class="limit-tag" style="left:${lim / vmax * 100}%">${lim} %g</div></div><div class="colorbar-ticks"><span>0</span><span>${fmt(vmax / 2, 2)}</span><span>${fmt(vmax, 2)}</span></div>`;
    } else if (mode === 'defl') {
      const dt = (v.DEF_j || 0) + (v.DEF_g || 0);
      bar = `<div class="hud-title">DG 11 deflection (in)</div><div class="colorbar"></div><div class="colorbar-ticks"><span>0</span><span>${fmt(dt / 2, 3)}</span><span>${fmt(dt, 3)}</span></div>`;
    } else bar = `<div class="hud-title">Floor</div><div class="small" style="color:#b4c0cc">Pick a colour mode to map the solver's vibration results onto the slab.</div>`;
    hud.innerHTML = `<div class="hud-card">${bar}</div>
      <div class="hud-card"><div class="hud-title">DG 11 walking check</div>
        <div class="hud-big" style="color:${ap <= lim ? '#A3B376' : '#E57373'}">${fmtFixed(ap, 3)} %g</div>
        <div class="hud-row"><span>limit</span><b>${lim} %g</b></div>
        <div class="hud-row"><span>f<sub>n</sub></span><b>${fmtFixed(v.fn, 2)} Hz</b></div>
        <div class="hud-row"><span>Δ<sub>j</sub> / Δ<sub>g</sub></span><b>${fmtFixed(v.DEF_j, 3)} / ${fmtFixed(v.DEF_g, 3)} in</b></div>
        <div class="hud-row"><span>W</span><b>${fmt(v.W, 0)} lb</b></div>
        <div id="hudLive"></div></div>`;
    renderHudLive();
  }
  function renderHudLive() {
    const el = $('#hudLive', root);
    const k = sel();
    if (!el || !result?.ok || !k) return;
    const v = result.captured[k].values;
    const ap = v.peak_acceleration, lim = v.tolerance_limit ?? 0.5;
    let html = '';
    const p = walk || hover || probe;
    if (bay.motion === 'walk' && walk) {
      html = `<div class="hud-row" style="margin-top:8px"><span>walker at</span><b>${fmt(walk.x, 1)}, ${fmt(walk.z, 1)} ft</b></div>
        <div class="hud-row"><span>response a<sub>p</sub>·φ</span><b style="color:${walk.accel <= lim ? '#A3B376' : '#E57373'}">${fmtFixed(walk.accel, 3)} %g</b></div>
        <div class="hud-row"><span>τ = 1/(2πβf<sub>n</sub>)</span><b>${fmtFixed(walk.tau, 2)} s</b></div>
        ${walk.pausing ? '<div class="hud-row"><span>off the bay</span><b>decaying</b></div>' : ''}
        <div class="tiny" style="color:#7d8b99;margin-top:4px">Illustration: DG 11's a<sub>p</sub> × the mode shape at the walker (reciprocity), building up and decaying as 1 − e<sup>−t/τ</sup> with the solver's β and f<sub>n</sub>.</div>`;
    } else if (p) {
      html = `<div class="hud-row" style="margin-top:8px"><span>at x, z</span><b>${fmt(p.x, 1)}, ${fmt(p.z, 1)} ft</b></div>
        <div class="hud-row"><span>φ</span><b>${fmtFixed(p.phi, 3)}</b></div>
        <div class="hud-row"><span>a<sub>p</sub>·φ</span><b style="color:${ap * p.phi <= lim ? '#A3B376' : '#E57373'}">${fmtFixed(ap * p.phi, 3)} %g</b></div>`;
    }
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------ analysis tabs
  const TABS = [['valid', 'Validation'], ['vars', 'Engine variables'], ['source', 'Solver source']];
  // Validation / Engine variables / Solver source live in a dialog, so the 3D view keeps the full centre column.
  function openAnalysis() {
    const dlg = $('#anDlg', root);
    if (!dlg.open) dlg.showModal();
    renderAnalysis();
  }
  function renderAnalysis() {
    if (!$('#anDlg', root).open) return;      // rendered when opened
    const tabs = $('#anTabs', root);
    const k = sel();
    const cap = result?.ok && k ? result.captured[k] : null;
    const badge = (t) => {
      if (!cap) return '';
      if (t === 'valid') { const ok = cap.validation?.all_ok !== false && (cap.recheck?.n_bad || 0) === 0; return `<span class="badge ${ok ? 'pass' : 'fail'}">${ok ? '✓' : '!'}</span>`; }
      return '';
    };
    tabs.innerHTML = TABS.map(([id, t]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${t}${badge(id)}</button>`).join('') +
      `<span class="spacer"></span><span class="tiny muted" style="white-space:nowrap">${cap ? `${esc(STATE_SHORT[k])} · ${Object.keys(cap.values).length} captured values` : ''}</span>` +
      `<button class="icon-btn" id="anClose" aria-label="Close" title="Close (Esc)">✕</button>`;
    $$('[data-tab]', tabs).forEach(b => b.onclick = () => { tab = b.dataset.tab; store.set('anTab', tab); renderAnalysis(); });
    $('#anClose', tabs).onclick = () => $('#anDlg', root).close();
    const body = $('#anBody', root);
    if (!cap) { body.innerHTML = `<div class="muted">${result && !result.ok ? 'No design — nothing to show.' : 'Run the solver to see every calculation.'}</div>`; return; }
    const ci = calcInfo[result.system];
    if (tab === 'vars') {
      body.innerHTML = `<div class="calc-toolbar"><input class="text-in" id="varQ" placeholder="Filter variables…" value="${esc(varFilter)}"></div>${C.renderAllVars(cap, { filter: varFilter })}`;
      $('#varQ', body).oninput = debounce((e) => { varFilter = e.target.value; renderAnalysis(); const q = $('#varQ', root); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200);
      bindRows(body, cap, ci);
    } else if (tab === 'valid') body.innerHTML = validationDetail(cap);
    else if (tab === 'source') renderSource(body, ci);
    $$('.var', body).forEach(s => s.onclick = (e) => { e.stopPropagation(); jumpVar(s.dataset.var); });
    $$('.ln[data-line]', body).forEach(s => { s.style.cursor = 'pointer'; s.onclick = (e) => { e.stopPropagation(); tab = 'source'; srcLine = +s.dataset.line; renderAnalysis(); }; });
  }

  function bindRows(body, cap, ci) {
    $$('tr.calc-row', body).forEach(tr => tr.onclick = () => {
      const nm = tr.dataset.var;
      const next = tr.nextElementSibling;
      if (next?.classList.contains('detail')) { next.remove(); return; }
      const td = h('td', { colspan: tr.children.length, html: C.detailHTML({ var: nm }, cap, ci) + (cap.orient[nm] === 'tbl' ? C.tableHTML(cap.values[nm], cap.values.selected_deck) : '') });
      const d = h('tr', { class: 'detail' }, td);
      tr.after(d);
      $$('.var', d).forEach(s => s.onclick = (e) => { e.stopPropagation(); jumpVar(s.dataset.var); });
      $$('.ln[data-line]', d).forEach(s => { s.style.cursor = 'pointer'; s.onclick = (e) => { e.stopPropagation(); tab = 'source'; srcLine = +s.dataset.line; renderAnalysis(); }; });
    });
  }

  function jumpVar(nm) {
    tab = 'vars'; varFilter = nm;
    openAnalysis();
    const row = $(`#anBody tr.calc-row[data-var="${CSS.escape(nm)}"]`, root);
    if (row) { row.click(); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  let srcLine = null;
  async function renderSource(body, ci) {
    body.innerHTML = '<div class="muted">Loading the solver cell…</div>';
    const src = await api.source(result.system);
    const lines = src.source.split('\n');
    body.innerHTML = `<div class="row small" style="margin-bottom:8px;flex-wrap:wrap"><span><b>${esc(src.notebook)}</b>, solver cell (${lines.length} lines) — executed verbatim by this tool.</span><span class="muted tiny">cell SHA-256 <code>${esc(src.cell_sha256)}</code></span></div>
      <div class="source-view" id="srcView">${lines.map((l, i) => `<div data-l="${i + 1}"${srcLine === i + 1 ? ' class="hl"' : ''}><span class="ln">${i + 1}</span>${esc(l)}</div>`).join('')}</div>`;
    if (srcLine) { const el = body.querySelector(`[data-l="${srcLine}"]`); el?.scrollIntoView({ block: 'center' }); }
  }

  function validationDetail(cap) {
    const res = result;
    const va = cap.validation, rc = cap.recheck, mt = res._match;
    const ci = calcInfo[res.system];
    const sp = C.carbonSplit(cap, ci);
    const tile = (big, lab, ok) => `<div class="val-tile"><div class="big" style="color:${ok === null ? 'var(--text2)' : ok ? 'var(--pass)' : 'var(--fail)'}">${big}</div><div class="lab">${lab}</div></div>`;
    let html = `<div class="small" style="margin-bottom:12px;max-width:900px;color:var(--text2)">Four independent checks that the numbers on screen are the paper's solver's own numbers.</div><div class="val-sum">`;
    if (va) html += tile(`${va.n_ok}/${va.n}`, 'reported outputs reproduced from captured internals', va.all_ok);
    if (rc) html += tile(`${rc.n_ok}`, `solver lines re-run at this pair reproduce their values (${rc.n_bad} differ, ${rc.n_skip} not re-evaluable)`, rc.n_bad === 0);
    html += tile(sp.ok ? '✓' : '✗', 'carbon parts sum to the solver\'s EC', sp.ok);
    html += mt ? tile(`${mt.nOk}/${mt.n}`, `match the published dataset, row ${mt.row + 1}`, mt.nOk === mt.n) : tile('—', 'outside the published grid (no dataset row)', null);
    html += '</div>';
    html += `<h4 style="margin:4px 0 6px">1 · Solver outputs vs captured internals</h4><div class="muted small" style="margin-bottom:6px">Each column the solver writes to its output frame for this state, against the internal variable it maps from (mapping read from the solver's <code>target_base_matrices</code> and <code>results</code> dict with <code>ast</code>).</div>`;
    if (va) {
      html += '<table class="calc"><thead><tr><th></th><th>Output column</th><th>Internal variable</th><th class="right">Reported</th><th class="right">Captured</th></tr></thead><tbody>';
      for (const c of va.checks) html += `<tr><td class="chk">${c.ok === null ? '<span class="skip-ic">·</span>' : c.ok ? '<span class="ok-ic">✓</span>' : c.known_quirk ? '<span class="pill warn">quirk</span>' : '<span class="bad-ic">✗</span>'}</td><td>${esc(c.column)}</td><td><code>${esc(c.local)}</code></td><td class="v">${c.reported === null ? '<span class="muted">blank in frame</span>' : C.valueHTML(c.reported)}</td><td class="v">${C.valueHTML(c.captured)}</td></tr>${c.known_quirk ? `<tr><td></td><td colspan="4" class="small muted">${esc(c.known_quirk)}</td></tr>` : ''}`;
      html += '</tbody></table>';
    } else html += '<div class="muted small">Not applicable to “Your design” — the solver reports no frame for a pair it did not pick; the line re-run below still applies.</div>';
    html += `<h4 style="margin:16px 0 6px">2 · Line-by-line re-execution</h4><div class="muted small" style="margin-bottom:6px">Every single-target assignment in <code>mitigation_method()</code> that is elementwise arithmetic is evaluated again with this pair's captured inputs. Elementwise numpy operations commute with indexing, so the result must equal the captured value of the target. Lines with table lookups, reductions across shapes or an untaken branch are listed as not re-evaluable.</div>`;
    const bad = Object.entries(rc.lines).filter(([, r]) => r[0] === false);
    html += bad.length ? bad.map(([ln, r]) => `<div class="code-line">L${ln} ${esc(ci.linesByNo[ln]?.var)} = ${esc(ci.linesByNo[ln]?.expr)}  → ${esc(JSON.stringify(r[1]))}</div>`).join('') : `<div class="pill pass">all ${rc.n_ok} re-evaluated lines reproduce the captured values</div>`;
    html += `<details style="margin-top:8px"><summary class="small" style="cursor:pointer">Show every re-evaluated line</summary><table class="calc" style="margin-top:6px"><tbody>${Object.entries(rc.lines).filter(([, r]) => r[0] !== null).map(([ln, r]) => `<tr><td class="chk">${r[0] ? '<span class="ok-ic">✓</span>' : '<span class="bad-ic">✗</span>'}</td><td class="tiny muted">L${ln}</td><td><code>${esc(ci.linesByNo[ln]?.var)}</code></td><td class="v">${C.valueHTML(Array.isArray(r[1]) ? r[1].map(x => +(+x).toPrecision(6)).join(' / ') : r[1])}</td></tr>`).join('')}</tbody></table></details>`;
    html += `<h4 style="margin:16px 0 6px">3 · Carbon take-off identity</h4><div class="code-line">${esc(sp.line)}</div><div class="small">${sp.parts.map(p => `${p.label} ${fmt(p.kg, 2)} kg`).join(' + ')} = <b>${fmt(sp.sum, 4)}</b> kg CO₂e · solver EC = <b>${fmt(sp.ec, 4)}</b> ${sp.ok ? '<span class="ok-ic">✓</span>' : '<span class="bad-ic">✗</span>'}</div>`;
    html += `<h4 style="margin:16px 0 6px">4 · Published dataset</h4>`;
    if (mt) {
      html += `<div class="muted small" style="margin-bottom:6px">Row ${mt.row + 1} of <code>${res.system}_results_imperial.csv</code> from the MS-Vibration-Code release (float32 in the browser, compared to 2×10⁻⁶ relative).</div><table class="calc"><thead><tr><th></th><th>State</th><th>Field</th><th class="right">Solver now</th><th class="right">Published</th></tr></thead><tbody>`;
      for (const c of mt.checks) html += `<tr><td class="chk">${c.ok ? '<span class="ok-ic">✓</span>' : '<span class="bad-ic">✗</span>'}</td><td>${esc(STATE_SHORT[c.state] || c.state)}</td><td>${esc(c.field)}</td><td class="v">${C.valueHTML(c.solver)}</td><td class="v">${C.valueHTML(c.dataset)}</td></tr>`;
      html += '</tbody></table>';
    } else html += '<div class="muted small">The published dataset covers residential bays, 10–50 ft spans in 1 ft steps, 25 / 50 / 75 % composite, deck continuous over 3 spans, 200 × 200 ft floor. These inputs are outside it.</div>';
    html += `<h4 style="margin:16px 0 6px">Provenance</h4><table class="prov-table"><tr><td>Solver</td><td><code>${esc(res.engine.notebook)}</code> (MS-Vibration-Code release), code cells up to <code>sizer_and_calc</code>, run verbatim</td></tr>
      <tr><td>Notebook SHA-256</td><td><code>${esc(res.engine.notebook_sha256)}</code></td></tr><tr><td>Solver cell SHA-256</td><td><code>${esc(res.engine.solver_cell_sha256)}</code></td></tr>
      <tr><td>Runtime</td><td>Python ${esc(res.engine.python)}, numpy ${esc(res.engine.numpy)}, pandas ${esc(res.engine.pandas)} · solve ${fmt(res.timing_s.solve, 2)} s + capture ${fmt(res.timing_s.capture, 2)} s</td></tr>
      <tr><td>Generated</td><td>${esc(res.generated_utc)} · tool ${esc(res.tool_version)}</td></tr></table>`;
    return html;
  }

  // close the engine-details dialog on a backdrop click
  $('#anDlg', root).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  onUnits(() => { if (result) { renderResults(); } syncInputs(); });

  // ------------------------------------------------------------------ public
  return {
    async show(qs) {
      readHash(qs);
      if (!shapes) {
        shapes = await loadShapes();
        buildInputs();
        writeHash();
        renderTools();
        preview();
        run();
      } else {
        syncInputs();
        writeHash();
        if (!result || !sameInputs(result) || (S.mode === 'check' && (result.request.infill_shape !== S.is || result.request.girder_shape !== S.gs))) run();
        else renderAll();
      }
    },
    loadDesign(p) {   // from the design-space explorer
      Object.assign(S, p, { mode: 'optimize', view: 'best' });
      store.set('designer', { ...S, auto: undefined });
    },
  };
}
