// Calculation report: a self-contained, printable HTML document built from one solver
// result. Every number in it is a captured value of the paper's solver.
import { esc } from '../lib/dom.js';
import { fmt, fmtFixed, LB_TO_KG, FT2_PER_M2, FT_TO_M } from '../lib/units.js';
import { METHOD_LABELS } from '../lib/colormap.js';
import * as C from './calcs.js';
import { calcItemHTML } from './calcpanel.js';
import { stackedBar } from '../lib/charts.js';
import * as V from './reportviz.js';
import { APP_NAME } from '../lib/brand.js';

const NAMES = { initial: 'Initial design', infill: 'Mitigated: upsize infills', girder: 'Mitigated: upsize girders', conc: 'Mitigated: add topping', steel: 'Mitigated: upsize infills + girders', best: 'Best (lowest-carbon passing)', check: 'Custom design (your members)' };
const SHORT = { initial: 'Initial', infill: 'Upsize infills', girder: 'Upsize girders', conc: 'Add topping', steel: 'Upsize both', best: 'Best', check: 'Your design' };
const STATE_COLOR = { initial: '#8b98a5', infill: '#85C1E9', girder: '#FCAE2E', conc: '#E57373', steel: '#4178BE', best: '#A3B376', check: '#14202b' };
const fig = (body, caption, n) => body ? `<figure class="figbox">${body}<figcaption><b>Figure ${n}.</b> ${caption}</figcaption></figure>` : '';

// the watermark: one letter-size page, NOT FOR DESIGN along its diagonal, pale red
const WM_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 1100" width="850" height="1100">'
  + '<text x="425" y="550" text-anchor="middle" dominant-baseline="middle" transform="rotate(-52 425 550)" textLength="1150" lengthAdjust="spacingAndGlyphs" '
  + 'font-family="Segoe UI, Roboto, Arial, sans-serif" font-weight="900" font-size="150" fill="#e53935" fill-opacity="0.12">NOT FOR DESIGN</text></svg>');

const CSS = `
:root{--pass:#5f7d22;--fail:#b83c3c;--warn:#b37400;--muted:#5d6b78;--line:#d6dde5;--text:#14202b;--text2:#33424f;--panel:#f6f8fa;--code-bg:#f4f6f9;--accent:#2f6db5;--c2:#2f6db5}
*{box-sizing:border-box} body{font:11.5px/1.45 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--text);margin:0;background:#e9edf2}
.page{max-width:900px;margin:0 auto;background:#fff;padding:34px 40px 50px}
h1{font-size:21px;margin:0 0 2px} h2{font-size:15px;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #1d2a36} h3{font-size:12.5px;margin:14px 0 6px} h4{font-size:12px;margin:12px 0 6px}
.muted{color:var(--muted)} .small{font-size:10.5px} .tiny{font-size:9.5px} .right{text-align:right} .row{display:flex;gap:8px;align-items:center} .spacer{flex:1}
code{font-family:Consolas,Menlo,monospace;font-size:10px}
table{border-collapse:collapse;width:100%} td,th{padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left} th{font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td.v{text-align:right;font-weight:600;white-space:nowrap} td.u{color:var(--muted);white-space:nowrap} td.chk{width:18px;text-align:center}
.pill{display:inline-block;padding:0 6px;border-radius:9px;font-size:9.5px;font-weight:700;border:1px solid var(--line)} .pill.pass{color:var(--pass);border-color:var(--pass)} .pill.fail{color:var(--fail);border-color:var(--fail)} .pill.warn{color:var(--warn);border-color:var(--warn)}
.ok-ic{color:var(--pass);font-weight:800}.bad-ic{color:var(--fail);font-weight:800}.skip-ic{color:var(--muted)}
.code-line{font-family:Consolas,Menlo,monospace;font-size:9.5px;white-space:pre-wrap;word-break:break-word;background:var(--code-bg);border:1px solid var(--line);border-radius:4px;padding:5px 7px;margin:3px 0}
.code-line .ln{color:var(--muted);margin-right:8px} .code-line .var{color:#1f5f9e}
.inputs-list{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:9.5px;color:var(--text2)}
.disc{border:1.5px solid #c98200;background:#fff8e6;border-radius:6px;padding:8px 11px;font-size:10.5px;color:#4a3a10;margin:10px 0}
.disc b{color:#8a5a00}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.kpi{border:1px solid var(--line);border-radius:6px;padding:7px 9px} .kpi b{font-size:16px;display:block}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.snap{width:100%;border:1px solid var(--line);border-radius:6px;background:#0a0e13;display:block}
.figbox{margin:12px 0 14px;break-inside:avoid} .figbox .fig{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px;background:#fff}
figcaption{font-size:10px;color:var(--text2);margin-top:4px;line-height:1.4} .grid2 .figbox{margin:0}
.verdict{border-radius:6px;padding:9px 12px;margin:0 0 10px;font-size:12px;border:1.5px solid} .verdict.ok{border-color:var(--pass);background:#f3f8ea} .verdict.bad{border-color:var(--fail);background:#fbefef}
.verdict.ok b:first-child{color:var(--pass)} .verdict.bad b:first-child{color:var(--fail)}
.tag{display:inline-block;font-size:9px;font-weight:700;padding:0 5px;border-radius:4px;background:#eef2f6;color:var(--muted);margin-left:4px;vertical-align:1px} .tag.you{background:#fff3dc;color:var(--warn)}
table.inputs tr.grp td{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--text);background:var(--panel);border-bottom:1px solid var(--line);padding-top:6px}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10px;color:var(--text2);margin-top:6px} .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.chain{display:grid;gap:5px} .chain-step{display:grid;grid-template-columns:24px 1fr auto;gap:8px;border:1px solid var(--line);border-radius:5px;padding:6px 8px;break-inside:avoid}
.chain-step .n{width:20px;height:20px;border-radius:50%;background:#e3e9ef;display:grid;place-items:center;font-size:9.5px;font-weight:700} .chain-step .sub{font-family:Consolas,monospace;font-size:9.5px;color:var(--text2)} .chain-step .res{text-align:right;white-space:nowrap}
.limit-table td,.limit-table th{font-size:10.5px} .ratio-bar{height:6px;border-radius:3px;background:#e3e9ef;position:relative;overflow:hidden;min-width:70px} .ratio-bar i{position:absolute;left:0;top:0;bottom:0}
.toolbar{position:sticky;top:0;z-index:5;background:#1d2a36;color:#fff;display:flex;gap:10px;align-items:center;padding:8px 16px}
.toolbar button{background:#4178BE;color:#fff;border:0;border-radius:6px;padding:7px 12px;font-weight:600;cursor:pointer} .toolbar button.alt{background:#33424f}
.rainbow{height:4px;background:linear-gradient(90deg,#4178BE,#85C1E9 25%,#A3B376 50%,#FCAE2E 75%,#E57373);margin:8px 0 14px;border-radius:2px}
.sec{break-inside:auto}
.foot{margin-top:28px;padding-top:10px;border-top:1px solid var(--line);font-size:9.5px;color:var(--muted)}
.calc-sec{break-inside:auto;margin-bottom:10px} .calc-sec .blurb{color:var(--muted);font-size:10px;margin-bottom:4px}
@page{size:letter;margin:14mm 12mm 16mm}
@media print{body{background:#fff}.toolbar{display:none}.page{padding:0;max-width:none}h2{break-after:avoid}.pagebreak{break-before:page}}
.page{position:relative}
.wm-sheet{position:absolute;inset:0;pointer-events:none;z-index:50;mix-blend-mode:multiply;background:url("${WM_SVG}") center top/100% auto repeat-y}
.wm{display:none}
@media print{.wm-sheet{display:none}.wm{display:grid;position:fixed;inset:0;place-items:center;pointer-events:none;z-index:50}.wm img{width:100%;height:100%;object-fit:contain;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
/* Mathcad-style regions (same renderer as the app's Calculations panel) */
:root{--info:#2f6db5;--font:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--mono:Consolas,Menlo,monospace}
.calc-item{break-inside:avoid;margin:0 0 8px;padding:0 0 8px;border-bottom:1px dotted var(--line)}
.ci-h{display:flex;gap:8px;align-items:baseline;margin:0 0 4px;font-size:11px}
.ci-h b{font-weight:650} .ci-h .spacer{flex:1}
.mc-wrap{overflow-x:auto;padding:7px 10px;background:#fcfdfe;border:1px solid var(--line);border-radius:4px}
.mc{display:grid;grid-template-columns:auto auto 1fr;column-gap:.35em;row-gap:8px;align-items:center;width:max-content;min-width:100%;font-family:"Cambria Math","STIX Two Math",Cambria,"Times New Roman",Georgia,serif;font-size:13.5px;line-height:1.25;color:var(--text)}
.mc-a{justify-self:end;white-space:nowrap} .mc-o{color:var(--text2);white-space:nowrap;padding:0 .1em} .mc-b{white-space:nowrap}
.mc i{font-style:italic} .mc sub{font-size:.68em;vertical-align:-.38em;font-style:normal;line-height:0} .mc sup{font-size:.72em;vertical-align:.62em;line-height:0}
.mo{margin:0 .2em} .mf{font-style:normal} .ms{font-family:var(--mono);font-size:.78em} .mq{white-space:nowrap}
.mu{font-family:var(--font);font-size:.74em;color:var(--info);margin-left:.25em;font-style:normal} .mres{font-weight:700}
.mfr{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 .1em} .mnu{padding:0 .25em .12em} .mde{padding:.14em .25em 0;border-top:1px solid currentColor}
.mrad{display:inline-flex;align-items:stretch;vertical-align:middle} .mrs{align-self:flex-end;padding-right:.04em}
.mrad.tall .mrs{font-size:1.9em;line-height:1;transform:scaleX(.75);transform-origin:right bottom} .mrb{border-top:1px solid currentColor;padding:.1em .15em 0;margin-top:.14em}
.mpar{display:inline-flex;align-items:stretch;vertical-align:middle} .mpl,.mpr{width:.3em;flex:0 0 .3em}
.mpl{border-left:1.3px solid currentColor;border-radius:.6em 0 0 .6em/50% 0 0 50%;margin-right:.08em} .mpr{border-right:1.3px solid currentColor;border-radius:0 .6em .6em 0/0 50% 50% 0;margin-left:.08em}
.mceil,.mflr{display:inline-block;border-left:1.2px solid currentColor;border-right:1.2px solid currentColor;padding:0 .22em;margin:0 .1em} .mceil{border-top:1.2px solid currentColor} .mflr{border-bottom:1.2px solid currentColor}
.mvec{display:inline-flex;flex-direction:column;vertical-align:middle;border-left:1.2px solid currentColor;border-right:1.2px solid currentColor;border-radius:2px;padding:0 .35em;line-height:1.15;font-size:.92em;text-align:right}
.mix{font-size:.62em!important} .mpill{font-family:var(--font);font-size:9.5px}
.mc-src{font-size:9px;color:var(--muted);margin:3px 2px 0;line-height:1.4} .mc-src .mc-ln{font-family:var(--mono);margin-right:4px;color:var(--muted)}
.mc-py{font-size:8.5px;color:var(--text2);word-break:break-word}
.mc-part{margin-bottom:6px} .mc-pt{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:2px 0 3px;font-weight:700}
.mc-util{display:flex;align-items:center;gap:8px;font-size:10px;margin-top:3px} .mc-util .ratio-bar{flex:1;max-width:220px}
@media print{.mc-wrap{overflow:visible;background:#fff}}
`;

// fit any region wider than the page (on screen and when printing)
const FIT_JS = `function fitMc(){document.querySelectorAll('.mc-wrap').forEach(function(w){var m=w.firstElementChild;if(!m)return;m.style.zoom='';m.style.minWidth='0';var avail=w.clientWidth-20,need=m.scrollWidth;m.style.minWidth='';if(need>avail+1&&avail>0)m.style.zoom=(avail/need).toFixed(3);});}
window.addEventListener('load',fitMc);window.addEventListener('resize',fitMc);window.addEventListener('beforeprint',fitMc);window.addEventListener('afterprint',fitMc);`;

function calcBlock(title, side, body) {
  return `<div class="calc-item"><div class="ci-h"><b>${title}</b><span class="spacer"></span>${side || ''}</div>${body}</div>`;
}

// every input the run used, grouped, with where it came from (your entry or the solver's own rule)
function inputsTable(res, v) {
  const i = res.inputs, r = res.request;
  const bu = (window.__msveMeta?.systems?.[res.system]?.building_uses || {})[i.Building_Use_num] || [];
  const you = '<span class="tag you">set by you</span>', solver = '<span class="tag">solver</span>';
  const comp = res.system === 'composite';
  const groups = [
    ['Bay', [
      ['Floor system', comp ? 'Composite steel beams on composite deck' : 'Non-composite steel beams on composite deck'],
      ['Mode', res.mode === 'check' ? 'Custom design: your members and settings, checked by the solver' : 'Optimize: the solver selects the lowest-carbon passing pair'],
      ['Girder span L<sub>g</sub>', `${i.Girder_Span} ft (${fmtFixed(i.Girder_Span * FT_TO_M, 2)} m)`],
      ['Infill span L<sub>j</sub>', `${i.Infill_Span} ft (${fmtFixed(i.Infill_Span * FT_TO_M, 2)} m)`],
      ['Beams between girders', `${v.NumInfill} at ${fmt(v.infill_spacing, 3)} ft ${r.num_infill ? you : solver + ' <span class="muted">(widest spacing the deck table allows)</span>'}`],
    ]],
    ['Slab and deck', [
      ['Concrete', i.Conc_Type_num ? 'Lightweight, 110 pcf' : 'Normal-weight, 145 pcf'],
      ['Deck', `${esc(v.selected_deck)}: ${i.Deck_Type} in ribs, continuous over ${i.Clear_Spans} span(s) during construction`],
      ['Total slab depth', `${fmt(v.Deck_Type + v.selected_deck_topping_thickness + (v.Additional_Topping || 0), 2)} in ${r.slab_total ? you : solver + ' <span class="muted">(lightest that works)</span>'}`],
      ...(comp ? [['Degree of composite action', `${i.percent_comp} %`]] : []),
    ]],
    ['Members', res.mode === 'check' ? [
      ['Infill beams', `<code>${esc(r.infill_shape)}</code> ${you}`],
      ['Girders', `<code>${esc(r.girder_shape)}</code> ${you}`],
      ...(comp ? [
        ['Camber', `infill ${fmt(v.camber_II, 2)} in ${r.camber_infill != null ? you : solver}, girder ${fmt(v.camber_IG, 2)} in ${r.camber_girder != null ? you : solver}`],
        ['Studs', `infill ${fmt(v.min_req_studs_II, 0)} ${r.studs_infill != null ? you : solver}, girder ${fmt(v.min_req_studs_IG, 0)} ${r.studs_girder != null ? you : solver}`],
      ] : []),
    ] : [['Infill beams and girders', `selected by the solver ${solver}`]]],
    ['Loads and criteria', [
      ['Occupancy', `${esc(bu[0] || i.Building_Use_num)}: LL ${bu[3]} psf, vibration LL ${bu[1]} psf, β = ${bu[4]}, limit a<sub>0</sub>/g = ${bu[2]} %g <span class="muted">(the solver's occupancy table)</span>`],
      ['Fixed in the published code', `SDL ${v.SDL} psf, construction LL 20 psf, F<sub>y</sub> ${v.Fy} ksi, E<sub>s</sub> ${fmt(v.Es, 0)} ksi, f′<sub>c</sub> ${v.f_prime_c} ksi; LRFD 1.4D and 1.2D + 1.6L`],
      ['Floor plate (DG 11 width limits)', `${i.floor_length} × ${i.floor_width} ft`],
    ]],
  ];
  let html = '<table class="inputs">';
  for (const [g, rows] of groups) {
    html += `<tr class="grp"><td colspan="2">${g}</td></tr>`;
    html += rows.map(([a, b]) => `<tr><td style="width:30%" class="muted">${a}</td><td>${b}</td></tr>`).join('');
  }
  return html + '</table>';
}

function statesTable(res) {
  const keys = res.mode === 'check' ? ['check', 'initial', 'infill', 'girder', 'conc', 'steel', 'best'] : ['initial', 'infill', 'girder', 'conc', 'steel', 'best'];
  let html = '<table><thead><tr><th>State</th><th>Infill</th><th>Girder</th><th class="right">Added topping</th><th class="right">a<sub>p</sub>/g (%g)</th><th class="right">f<sub>n</sub> (Hz)</th><th class="right">EC (kg CO₂e/m²)</th><th class="right">EC (lb CO₂e/ft²)</th></tr></thead><tbody>';
  for (const k of keys) {
    let inf, gir, pa, fn, ec, add, applies;
    if (k === 'check') { const v = res.captured.check.values; inf = res.request.infill_shape; gir = res.request.girder_shape; pa = v.peak_acceleration; fn = v.fn; ec = v.EC_scaled; add = 0; applies = true; }
    else { const s = res.states[k]; applies = s._applies; inf = s['Infill Sizes']; gir = s['Girder Sizes']; pa = s['Peak Acceleration']; fn = s['Fundamental Frequency']; ec = s['Embodied Carbon Scaled']; add = s['Additional Topping']; }
    if (!applies) { html += `<tr><td>${NAMES[k]}</td><td colspan="7" class="muted">does not apply (not needed, or no passing design on this path)</td></tr>`; continue; }
    html += `<tr><td>${NAMES[k]}</td><td><code>${esc(inf)}</code></td><td><code>${esc(gir)}</code></td><td class="right">${add ? fmt(add, 2) + ' in' : '—'}</td><td class="v">${fmtFixed(pa, 4)}</td><td class="v">${fmtFixed(fn, 3)}</td><td class="v">${fmtFixed(ec * FT2_PER_M2, 3)}</td><td class="v">${fmtFixed(ec / LB_TO_KG, 4)}</td></tr>`;
  }
  return html + '</tbody></table>';
}

export function buildReport({ result: res, key, calcInfo, shapes, views = [], model }) {
  const cap = res.captured[key];
  const v = cap.values;
  const comp = res.system === 'composite';
  const shot = (k) => views.find(s => s.key === k);
  let figN = 0;
  const F = (body, caption) => (body ? fig(body, caption, ++figN) : '');
  const img = (k, caption) => { const s = shot(k); return s ? F(`<img class="snap" src="${s.src}" alt="${esc(s.title)}">`, caption || esc(s.title)) : ''; };
  // story figures, all from this design's captured values
  const ld = (lc1, lc2) => (lc2 >= lc1 ? '1.2D + 1.6L governs' : '1.4D governs');
  const infillFig = V.beamDiagram({
    title: `Infill beam ${model.infill.name}`, span: v.Infill_Span, kind: 'udl', Vu: V.pick(v, 'V_FL_II'), Mu: V.pick(v, 'M_FL_II'),
    phiMn: comp ? V.pick(v, 'Phi_Mn_II') : V.pick(v, 'PhiMn_II'), phiVn: V.pick(v, 'PhiVnx_II'), color: '#4178BE',
    loadTxt: `w_D ${fmt(V.pick(v, 'W_DL_II'), 3)} klf, w_L ${fmt(V.pick(v, 'W_LL_II'), 3)} klf (tributary ${fmt(V.pick(v, 'Trib_II'), 2)} ft); ${ld(v.M_II_LC1, v.M_II_LC2)}`,
  });
  const girderFig = V.beamDiagram({
    title: `Girder ${model.girder.name}`, span: v.Girder_Span, kind: 'points', nLoads: v.NumInfill, spacing: v.infill_spacing,
    Vu: V.pick(v, 'V_FL_IG'), Mu: V.pick(v, 'M_FL_IG'), phiMn: comp ? V.pick(v, 'Phi_Mn_IG') : V.pick(v, 'PhiMn_IG'), phiVn: V.pick(v, 'PhiVnx_IG'), color: '#FCAE2E',
    loadTxt: `${v.NumInfill} infill reactions at ${fmt(v.infill_spacing, 3)} ft plus self-weight; ${ld(v.M_IG_LC1, v.M_IG_LC2)}`,
  });
  const util = V.utilisation(['infill', 'girder'].flatMap(g => calcInfo.checks[g].filter(c => !c.flag || c.flag in v).map(c => {
    const r = C.checkRow(c, v);
    return { group: g === 'infill' ? 'Infill' : 'Girder', label: r.c.label, ratio: r.ratio };
  })));
  const stateKeys = (res.mode === 'check' ? ['check'] : []).concat(['initial', 'infill', 'girder', 'conc', 'steel', 'best']);
  const tradePts = stateKeys.map(k => {
    if (k === 'check') { const c = res.captured.check?.values; return c && { label: SHORT[k], pa: c.peak_acceleration, ec: V.ecM2(c.EC_scaled), color: STATE_COLOR[k], sel: k === key }; }
    const s = res.states[k];
    return s?._applies && { label: SHORT[k], pa: s['Peak Acceleration'], ec: V.ecM2(s['Embodied Carbon Scaled']), color: STATE_COLOR[k], sel: k === key };
  }).filter(Boolean).reduce((acc, p) => {         // states at the same point (best = one of the others): one dot, joint label
    const twin = acc.find(q => q.pa === p.pa && q.ec === p.ec);
    if (twin) { twin.label += ` = ${p.label}`; twin.sel = twin.sel || p.sel; if (p.label === SHORT.best) twin.color = STATE_COLOR.best; } else acc.push({ ...p });
    return acc;
  }, []);
  const sp = C.carbonSplit(cap, calcInfo);
  const va = cap.validation, rc = cap.recheck, mt = res._match;
  const pass = v.peak_acceleration <= v.tolerance_limit;
  const title = `${res.system === 'composite' ? 'Composite' : 'Non-composite'} bay ${res.inputs.Girder_Span} × ${res.inputs.Infill_Span} ft — ${NAMES[key]}`;
  const memberRow = (lab, mm) => {
    const d = shapes.byName[mm.name] || {};
    return `<tr><td class="muted" style="width:22%">${lab}</td><td><b><code>${esc(mm.name)}</code></b> — d ${d.d} in, b<sub>f</sub> ${d.bf} in, t<sub>f</sub> ${d.tf} in, t<sub>w</sub> ${d.tw} in, ${d.W} lb/ft, I<sub>x</sub> ${d.Ix} in⁴${res.system === 'composite' ? `<br>${fmt(mm.studs, 0)} × ¾ in studs${mm.perRib > 1 ? ` (${mm.perRib} per rib)` : ''}, camber ${mm.camber || 0} in` : ''}</td></tr>`;
  };
  // Mathcad-style regions: checks (section 3), DG 11 (section 4), everything else (appendix A)
  const varBlock = (it) => calcBlock(`${it.label}${it.member ? ` <span class="muted">(${it.member})</span>` : ''}`,
    `<code class="muted">${esc(it.var)}</code>`, calcItemHTML({ kind: 'var', it }, calcInfo, cap));
  let checkCalcs = '';
  for (const grp of ['infill', 'girder']) {
    const items = calcInfo.checks[grp].filter(c => c.flag in v);
    if (!items.length) continue;
    checkCalcs += `<h3>${grp === 'infill' ? 'Infill beam' : 'Girder'}</h3>`;
    for (const c of items) {
      const r = C.checkRow(c, v);
      const pill = r.unknown ? '<span class="pill">n/a</span>' : r.pass ? '<span class="pill pass">pass</span>' : '<span class="pill fail">fail</span>';
      checkCalcs += calcBlock(esc(r.c.label), `<span class="muted tiny">${esc(c.clause)}</span> ${pill}`, calcItemHTML({ kind: 'check', c, grp }, calcInfo, cap));
    }
  }
  const vibSec = calcInfo.sections.find(s => s.id === 'vibration');
  const vibCalcs = vibSec ? vibSec.items.filter(it => it.var in v).map(varBlock).join('') : '';
  let appx = '';
  for (const sec of calcInfo.sections) {
    if (sec.id === 'vibration') continue;
    const items = sec.items.filter(it => it.var in v);
    if (!items.length) continue;
    appx += `<div class="calc-sec"><h3>${esc(sec.title)}</h3><div class="blurb">${esc(sec.blurb)}</div>${items.map(varBlock).join('')}</div>`;
  }
  const mcNote = `<div class="small muted" style="margin:0 0 8px">Each calculation is the solver's own notebook line, set out three ways: in symbols (:=), with the captured inputs and their units substituted, and the captured value. Nothing is recomputed for the report. Numbers written into a line (12, 144, 1000, 1728, 386 …) are the solver's unit conversions. ✓ = re-running that exact line on these inputs reproduces the value. L-numbers refer to the notebook's solver cell.</div>`;
  const disc = `<div class="disc"><b>Research showcase — not for design.</b> Generated by ${APP_NAME}, the companion tool to <i>Carbon-Efficient Design Strategies for Mitigating Footfall Vibration in Steel Framed Floor Systems</i> (Farrow, Brown and Solnosky). It reproduces the study's published solver for one bay under the study's assumptions. It is not a structural design, check or professional opinion, must not be used to design or approve any structure, and is provided "as is" without warranty under the MIT License; the authors and their institution accept no liability for any use.</div>`;

  // printed footer on every sheet, in the page's bottom margin (so it never sits over the content), with page numbers
  const cssStr = t => '"' + String(t).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3C ') + '"';
  const runFoot = `@page{@bottom-left{content:${cssStr(`${APP_NAME} ${res.tool_version} — research showcase, NOT FOR DESIGN · ${title} · generated ${res.generated_utc} · solver cell SHA-256 ${res.engine.solver_cell_sha256.slice(0, 16)}… · farrowsky.github.io/parafloor`)};font:8px "Segoe UI",Roboto,Arial,sans-serif;color:#6a7988;vertical-align:middle}`
    + `@bottom-right{content:"Page " counter(page) " of " counter(pages);white-space:nowrap;width:22mm;text-align:right;font:8px "Segoe UI",Roboto,Arial,sans-serif;color:#6a7988;vertical-align:middle}}`;
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calc report — ${esc(title)}</title><style>${CSS}</style></head><body>
<div class="toolbar"><b>Calculation report</b><span class="spacer"></span><button onclick="window.print()">Print / save as PDF</button><button class="alt" id="dl">Download HTML</button></div>
<div class="wm" aria-hidden="true"><img src="${WM_SVG}" alt=""></div>
<style>${runFoot}</style>
<div class="page"><div class="wm-sheet" aria-hidden="true"></div>
<div class="row"><div><div class="muted small">${APP_NAME} · calculation report</div><h1>${esc(title)}</h1>
<div class="muted small">Generated ${esc(res.generated_utc)} · tool ${esc(res.tool_version)} · ${esc(res.engine.notebook)}</div></div></div>
<div class="rainbow"></div>
${disc}

<div class="sec"><h2>1 · Summary</h2>
<div class="verdict ${pass ? 'ok' : 'bad'}"><b>${pass ? '✓ Meets' : '✗ Exceeds'} the DG 11 walking limit</b> — a<sub>p</sub>/g = ${fmtFixed(v.peak_acceleration, 3)} %g against ${v.tolerance_limit} %g, with infill <code>${esc(model.infill.name)}</code> and girder <code>${esc(model.girder.name)}</code>${C.structuralPass(calcInfo, v) ? '; every strength and deflection check passes' : '; <b>at least one strength or deflection check fails</b> (section 4)'}.</div>
<div class="kpis"><div class="kpi"><span class="muted tiny">Peak acceleration</span><b style="color:${pass ? 'var(--pass)' : 'var(--fail)'}">${fmtFixed(v.peak_acceleration, 4)} %g</b><span class="tiny">limit ${v.tolerance_limit} %g — ${pass ? 'meets' : 'exceeds'}</span></div>
<div class="kpi"><span class="muted tiny">Floor frequency f<sub>n</sub></span><b>${fmtFixed(v.fn, 3)} Hz</b><span class="tiny">f<sub>j</sub> ${fmtFixed(v.fj, 3)} · f<sub>g</sub> ${fmtFixed(v.fg, 3)}</span></div>
<div class="kpi"><span class="muted tiny">Embodied carbon</span><b>${fmtFixed(v.EC_scaled * FT2_PER_M2, 3)} kg CO₂e/m²</b><span class="tiny">${fmtFixed(v.EC_scaled / LB_TO_KG, 4)} lb CO₂e/ft² · ${fmt(v.EC, 1)} kg per bay</span></div>
<div class="kpi"><span class="muted tiny">Best method (solver)</span><b style="font-size:12.5px">${esc(METHOD_LABELS[res.condition_class] || res.method)}</b><span class="tiny">code ${res.condition_class}${res.method_published !== res.condition_class ? ` (published as ${res.method_published})` : ''}</span></div></div>
${img('hero', '3D view from the tool, floor coloured by the DG 11 peak acceleration (the paper\'s colormap; red at the 0.5 %g limit).')}
<h3>Members and slab</h3><table>${memberRow('Infill beams', model.infill)}${memberRow('Girders', model.girder)}
<tr><td class="muted">Deck and slab</td><td>${esc(v.selected_deck)} — topping ${fmt(v.selected_deck_topping_thickness, 2)} in${v.Additional_Topping ? ` + ${v.Additional_Topping} in added` : ''}; deck ${fmt(v.selected_deck_SW, 2)} psf; slab ${fmt(v.Final_Slab_SW, 2)} psf</td></tr>
<tr><td class="muted">Framing</td><td>${v.NumInfill} interior infills at ${fmt(v.infill_spacing, 4)} ft; bay area ${fmt(v.bay_area, 0)} ft²</td></tr></table></div>

<div class="sec pagebreak"><h2>2 · Inputs</h2>${inputsTable(res, v)}
${F(V.framingPlan(v), 'Framing plan to scale, with the tributary width of a typical infill (blue) and of one girder (orange), and the area loads the solver applies.')}</div>

<div class="sec pagebreak"><h2>3 · The bay in the tool</h2><div class="grid2">
${img('plan', 'Plan view: members, deck and dimensions.')}
${img('section', 'Section at mid-span: slab, deck ribs, studs and girder.')}
${img('panels', 'DG 11 combined mode shape with the effective panel widths B<sub>j</sub> and B<sub>g</sub>.')}
${img('under', 'Underside: deck ribs, studs and the infill-to-girder connections.')}</div></div>

<div class="sec pagebreak"><h2>4 · Strength and deflection</h2>
<div class="small muted" style="margin-bottom:6px">LRFD, AISC 360. The diagrams show the factored demand on each member; the peaks are the solver's M<sub>u</sub> and V<sub>u</sub>, and the dashed line is its design strength.</div>
${F(infillFig, `Infill beam: uniform load, shear and moment. φM<sub>n</sub> is the ${comp ? 'composite' : 'bare-steel'} design strength.`)}
${F(girderFig, 'Girder: the infills frame in as point loads; shear and moment from the solver.')}
${comp ? F(V.stressBlock(v, 'II', `Infill ${model.infill.name}`), 'Infill composite section (vertical scale true) and plastic stress distribution: concrete block a at 0.85 f′<sub>c</sub>, steel at F<sub>y</sub> above and below the plastic neutral axis. C<sub>c</sub> acts at Y<sub>2</sub> from the top of the steel, as the solver computes it.') : ''}
${comp ? F(V.stressBlock(v, 'IG', `Girder ${model.girder.name}`), 'Girder composite section and plastic stress distribution, as above.') : ''}
${F(util, 'Utilisation of every check with a demand and a capacity (demand ÷ capacity; deflections against their limits). Pass or fail is the solver\'s own result for each check.')}
${C.renderChecks(calcInfo, cap, res.inputs, { mode: res.mode })}</div>
<div class="calc-sec"><h3 style="margin-top:16px">4.1 · Check calculations</h3>${mcNote}${checkCalcs}</div>

<div class="calc-sec pagebreak"><h2>5 · Floor vibration — AISC Design Guide 11 (walking)</h2>
${F(V.dg11Curve(v), 'Peak acceleration against floor frequency for this floor\'s effective weight W and damping β (the solver\'s a<sub>p</sub>/g line). The point is the design: raising f<sub>n</sub> or W moves it down the curve.')}
<div class="small muted" style="margin-bottom:6px">Chapter 4 walking-excitation procedure as coded in the solver (paper Fig. 4), in the solver's order.</div>${vibCalcs}</div>

<div class="sec pagebreak"><h2>6 · Mitigation: vibration against carbon</h2>
${F(V.tradeoff(tradePts, v.tolerance_limit), 'Every design state the solver produced: peak acceleration against embodied carbon. The shaded side exceeds the limit; the outlined point is the state in this report.')}
<h3>All design states</h3>${statesTable(res)}</div>

<div class="sec"><h2>7 · Embodied carbon take-off</h2>
${F(stackedBar(sp.parts.map(p => ({ label: p.label, value: p.kg, color: p.color })), { width: 640, height: 40 }) + `<div class="legend">${sp.parts.map(p => `<span><i style="background:${p.color}"></i>${p.label} ${fmt(100 * p.kg / sp.sum, 1)} %</span>`).join('')}</div>`, `Where the carbon is: ${fmt(sp.sum, 1)} kg CO₂e per bay.`)}
<div class="code-line">${esc(sp.line)}</div>
<table><thead><tr><th>Component</th><th class="right">Take-off mass (lb)</th><th class="right">Factor (kg CO₂e/kg)</th><th class="right">kg CO₂e per bay</th><th class="right">Share</th></tr></thead><tbody>
${sp.parts.map(p => { const mass = { infill: v.steel_w_infill, girder: v.steel_w_girder, deck: v.steel_deck_w, conc: v.conc_w, studs: v.studs_w }[p.key]; const f = { infill: sp.factors.steel, girder: sp.factors.steel, deck: sp.factors.deck, conc: sp.factors.conc, studs: sp.factors.studs }[p.key]; return `<tr><td>${p.label}</td><td class="v">${fmt(mass, 1)}</td><td class="v">${fmt(f, 3)}</td><td class="v">${fmt(p.kg, 2)}</td><td class="v">${fmt(100 * p.kg / sp.sum, 1)} %</td></tr>`; }).join('')}
<tr><td><b>Total</b> (solver EC ${fmt(sp.ec, 4)} ${sp.ok ? '<span class="ok-ic">✓</span>' : '<span class="bad-ic">✗</span>'})</td><td></td><td></td><td class="v">${fmt(sp.sum, 4)}</td><td></td></tr></tbody></table>
<div class="small muted">Masses in lb are converted to kg (× ${v.LB_TO_KG ?? LB_TO_KG}) before the Table 3 factors. Per floor area: ${fmtFixed(v.EC_scaled, 5)} kg CO₂e/ft² = ${fmtFixed(v.EC_scaled * FT2_PER_M2, 4)} kg CO₂e/m² = ${fmtFixed(v.EC_scaled / LB_TO_KG, 5)} lb CO₂e/ft².</div></div>

<div class="sec"><h2>8 · Validation</h2><table>
${va ? `<tr><td style="width:46%">Solver output columns reproduced from captured internals</td><td><b>${va.n_ok}/${va.n}</b> ${va.all_ok ? '<span class="pill pass">pass</span>' : '<span class="pill fail">check</span>'}${va.n_known_quirk ? ` <span class="pill warn">${va.n_known_quirk} known reporting quirk</span>` : ''}</td></tr>` : ''}
<tr><td>Solver lines re-executed at this pair</td><td><b>${rc.n_ok}</b> reproduce, <b>${rc.n_bad}</b> differ, ${rc.n_skip} not re-evaluable ${rc.n_bad === 0 ? '<span class="pill pass">pass</span>' : '<span class="pill fail">check</span>'}</td></tr>
<tr><td>Carbon components sum to the solver's EC</td><td>${sp.ok ? '<span class="pill pass">pass</span>' : '<span class="pill fail">check</span>'}</td></tr>
<tr><td>Published dataset (MS-Vibration-Code)</td><td>${mt ? `<b>${mt.nOk}/${mt.n}</b> values match row ${mt.row + 1} ${mt.nOk === mt.n ? '<span class="pill pass">pass</span>' : '<span class="pill fail">check</span>'}` : '<span class="muted">inputs outside the published grid</span>'}</td></tr></table>
${va && va.checks.some(c => c.known_quirk && c.ok === false) ? `<div class="small muted" style="margin-top:6px">${esc(va.checks.find(c => c.known_quirk && c.ok === false).known_quirk)}</div>` : ''}
<h3>Provenance</h3><table><tr><td class="muted" style="width:30%">Solver</td><td>${esc(res.engine.notebook)}, code cells up to <code>sizer_and_calc</code>, executed unmodified</td></tr>
<tr><td class="muted">Notebook SHA-256</td><td><code>${esc(res.engine.notebook_sha256)}</code></td></tr><tr><td class="muted">Solver cell SHA-256</td><td><code>${esc(res.engine.solver_cell_sha256)}</code></td></tr>
<tr><td class="muted">Runtime</td><td>Python ${esc(res.engine.python)}, numpy ${esc(res.engine.numpy)}, pandas ${esc(res.engine.pandas)}</td></tr>
<tr><td class="muted">Selected pair</td><td>infill index ${cap.r}, girder index ${cap.c} in the solver's 273 × 273 W-shape matrices${cap.additional_topping ? `; additional topping ${cap.additional_topping} in` : ''}</td></tr></table></div>

<div class="calc-sec pagebreak"><h2>Appendix A · Calculations by section</h2>${mcNote}${appx}</div>

<div class="sec pagebreak"><h2>Appendix B · Every captured engine variable</h2>${C.renderAllVars(cap, { ci: calcInfo })}</div>

<div class="foot">${disc}
Cite: S. D. Farrow, N. C. Brown, R. L. Solnosky, <i>Carbon-Efficient Design Strategies for Mitigating Footfall Vibration in Steel Framed Floor Systems</i>, Engineering Structures (under review). Code and data: MS-Vibration-Code (MIT License).</div>
</div>
<script>${FIT_JS}document.getElementById('dl').onclick=function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}));a.download=${JSON.stringify(`calc_report_${res.system}_${res.inputs.Girder_Span}x${res.inputs.Infill_Span}_${key}.html`)};a.click();};<\/script>
</body></html>`;
  return doc;
}

export function openReport(args) {
  if (!args.result?.ok || !args.key || !args.calcInfo) return;
  const html = buildReport(args);
  // shown in-page (no popup blocker can stop it); print / download work from inside the frame
  document.getElementById('reportView')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'reportView';
  wrap.className = 'lightbox';
  wrap.style.gridTemplateRows = 'auto 1fr';
  wrap.innerHTML = `<div class="lb-head"><h3>Calculation report</h3><span class="spacer"></span>
    <button class="btn btn-sm btn-primary" id="rvPrint">Print / save as PDF</button>
    <button class="btn btn-sm" id="rvTab">Open in new tab</button>
    <button class="btn btn-sm" id="rvClose" aria-label="Close the report">✕ Close</button></div>
    <iframe title="Calculation report" style="width:100%;height:100%;border:0;background:#e9edf2"></iframe>`;
  document.body.append(wrap);
  const frame = wrap.querySelector('iframe');
  frame.srcdoc = html;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  wrap.querySelector('#rvClose').onclick = close;
  wrap.querySelector('#rvPrint').onclick = () => frame.contentWindow?.print();
  wrap.querySelector('#rvTab').onclick = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank', 'noopener');
    if (!w) { const a = document.createElement('a'); a.href = url; a.download = 'calc_report.html'; a.click(); }
  };
}
