// Calculation report: a self-contained, printable HTML document built from one solver
// result. Every number in it is a captured value of the paper's solver.
import { esc } from '../lib/dom.js';
import { fmt, fmtFixed, LB_TO_KG, FT2_PER_M2, FT_TO_M } from '../lib/units.js';
import { METHOD_LABELS } from '../lib/colormap.js';
import * as C from './calcs.js';
import { calcItemHTML } from './calcpanel.js';

const NAMES = { initial: 'Initial design', infill: 'Mitigated: upsize infills', girder: 'Mitigated: upsize girders', conc: 'Mitigated: add topping', steel: 'Mitigated: upsize infills + girders', best: 'Best (lowest-carbon passing)', check: 'User-selected members' };

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
.snap{width:100%;border:1px solid var(--line);border-radius:6px;background:#0a0e13}
.chain{display:grid;gap:5px} .chain-step{display:grid;grid-template-columns:24px 1fr auto;gap:8px;border:1px solid var(--line);border-radius:5px;padding:6px 8px;break-inside:avoid}
.chain-step .n{width:20px;height:20px;border-radius:50%;background:#e3e9ef;display:grid;place-items:center;font-size:9.5px;font-weight:700} .chain-step .sub{font-family:Consolas,monospace;font-size:9.5px;color:var(--text2)} .chain-step .res{text-align:right;white-space:nowrap}
.limit-table td,.limit-table th{font-size:10.5px} .ratio-bar{height:6px;border-radius:3px;background:#e3e9ef;position:relative;overflow:hidden;min-width:70px} .ratio-bar i{position:absolute;left:0;top:0;bottom:0}
.toolbar{position:sticky;top:0;z-index:5;background:#1d2a36;color:#fff;display:flex;gap:10px;align-items:center;padding:8px 16px}
.toolbar button{background:#4178BE;color:#fff;border:0;border-radius:6px;padding:7px 12px;font-weight:600;cursor:pointer} .toolbar button.alt{background:#33424f}
.rainbow{height:4px;background:linear-gradient(90deg,#4178BE,#85C1E9 25%,#A3B376 50%,#FCAE2E 75%,#E57373);margin:8px 0 14px;border-radius:2px}
.sec{break-inside:avoid-page}
.foot{margin-top:28px;padding-top:10px;border-top:1px solid var(--line);font-size:9.5px;color:var(--muted)}
.calc-sec{break-inside:auto;margin-bottom:10px} .calc-sec .blurb{color:var(--muted);font-size:10px;margin-bottom:4px}
@page{size:letter;margin:14mm 12mm 16mm}
@media print{body{background:#fff}.toolbar{display:none}.page{padding:0;max-width:none}h2{break-after:avoid}.pagebreak{break-before:page}
  .runfoot{position:fixed;bottom:-10mm;left:0;right:0;font-size:8.5px;color:#6a7988;text-align:center}}
.runfoot{display:none} @media print{.runfoot{display:block}}
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

function inputsTable(res) {
  const i = res.inputs, r = res.request;
  const bu = (window.__msveMeta?.systems?.[res.system]?.building_uses || {})[i.Building_Use_num] || [];
  const rows = [
    ['Floor system', res.system === 'composite' ? 'Composite steel beams on composite deck' : 'Non-composite steel beams on composite deck'],
    ['Mode', res.mode === 'check' ? `Check user-selected members: infill ${esc(r.infill_shape)}, girder ${esc(r.girder_shape)}` : 'Optimize: solver selects the lowest-carbon passing pair'],
    ['Girder span L<sub>g</sub>', `${i.Girder_Span} ft (${fmtFixed(i.Girder_Span * FT_TO_M, 2)} m)`],
    ['Infill span L<sub>j</sub>', `${i.Infill_Span} ft (${fmtFixed(i.Infill_Span * FT_TO_M, 2)} m)`],
    ['Concrete', i.Conc_Type_num ? 'Lightweight, 110 pcf' : 'Normal-weight, 145 pcf'],
    ['Deck rib depth', `${i.Deck_Type} in, continuous over ${i.Clear_Spans} span(s)`],
  ];
  if (res.system === 'composite') rows.push(['Partial composite connection', `${i.percent_comp} %`]);
  rows.push(['Occupancy (solver table)', `${esc(bu[0] || i.Building_Use_num)} — LL ${bu[3]} psf, vibration LL ${bu[1]} psf, β = ${bu[4]}, a<sub>0</sub>/g = ${bu[2]} %g`]);
  rows.push(['Floor plate for DG 11 width limits', `${i.floor_length} × ${i.floor_width} ft`]);
  if (res.variant) rows.push(['<b>Set by the user</b>', `${esc(res.variant.note)}${res.variant.member && Object.keys(res.variant.member).length ? ' Camber and stud values apply to the checked pair only; the optimizer states use the solver\'s own values.' : ''}`]);
  return `<table>${rows.map(([a, b]) => `<tr><td style="width:36%" class="muted">${a}</td><td>${b}</td></tr>`).join('')}</table>`;
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

export function buildReport({ result: res, key, calcInfo, shapes, snapshot, model }) {
  const cap = res.captured[key];
  const v = cap.values;
  const sp = C.carbonSplit(cap, calcInfo);
  const va = cap.validation, rc = cap.recheck, mt = res._match;
  const pass = v.peak_acceleration <= v.tolerance_limit;
  const title = `${res.system === 'composite' ? 'Composite' : 'Non-composite'} bay ${res.inputs.Girder_Span} × ${res.inputs.Infill_Span} ft — ${NAMES[key]}`;
  const memberRow = (lab, mm) => {
    const d = shapes.byName[mm.name] || {};
    return `<tr><td class="muted" style="width:22%">${lab}</td><td><b><code>${esc(mm.name)}</code></b> — d ${d.d} in, b<sub>f</sub> ${d.bf} in, t<sub>f</sub> ${d.tf} in, t<sub>w</sub> ${d.tw} in, ${d.W} lb/ft, I<sub>x</sub> ${d.Ix} in⁴${res.system === 'composite' ? `<br>${fmt(mm.studs, 0)} × ¾ in studs${mm.perRib > 1 ? ` (${mm.perRib} per rib)` : ''}, camber ${mm.camber || 0} in` : ''}</td></tr>`;
  };
  // Mathcad-style regions: checks (section 3), DG 11 (section 4), everything else (appendix A)
  const varBlock = (it) => calcBlock(`${esc(it.label)}${it.member ? ` <span class="muted">(${it.member})</span>` : ''}`,
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
  const disc = `<div class="disc"><b>Research showcase — not for design.</b> Generated by MS Vibration Explorer, the companion tool to <i>Carbon-Efficient Design Strategies for Mitigating Footfall Vibration in Steel Framed Floor Systems</i> (Farrow, Brown and Solnosky). It reproduces the study's published solver for one bay under the study's assumptions. It is not a structural design, check or professional opinion, must not be used to design or approve any structure, and is provided "as is" without warranty under the MIT License; the authors and their institution accept no liability for any use.</div>`;

  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calc report — ${esc(title)}</title><style>${CSS}</style></head><body>
<div class="toolbar"><b>Calculation report</b><span class="spacer"></span><button onclick="window.print()">Print / save as PDF</button><button class="alt" id="dl">Download HTML</button></div>
<div class="runfoot">MS Vibration Explorer — research showcase, not for design · ${esc(res.generated_utc)} · solver cell SHA-256 ${esc(res.engine.solver_cell_sha256.slice(0, 16))}…</div>
<div class="page">
<div class="row"><div><div class="muted small">MS Vibration Explorer · calculation report</div><h1>${esc(title)}</h1>
<div class="muted small">Generated ${esc(res.generated_utc)} · tool ${esc(res.tool_version)} · ${esc(res.engine.notebook)}</div></div></div>
<div class="rainbow"></div>
${disc}

<div class="sec"><h2>1 · Inputs</h2>${inputsTable(res)}</div>

<div class="sec"><h2>2 · Result</h2>
<div class="kpis"><div class="kpi"><span class="muted tiny">Peak acceleration</span><b style="color:${pass ? 'var(--pass)' : 'var(--fail)'}">${fmtFixed(v.peak_acceleration, 4)} %g</b><span class="tiny">limit ${v.tolerance_limit} %g — ${pass ? 'meets' : 'exceeds'}</span></div>
<div class="kpi"><span class="muted tiny">Floor frequency f<sub>n</sub></span><b>${fmtFixed(v.fn, 3)} Hz</b><span class="tiny">f<sub>j</sub> ${fmtFixed(v.fj, 3)} · f<sub>g</sub> ${fmtFixed(v.fg, 3)}</span></div>
<div class="kpi"><span class="muted tiny">Embodied carbon</span><b>${fmtFixed(v.EC_scaled * FT2_PER_M2, 3)} kg CO₂e/m²</b><span class="tiny">${fmtFixed(v.EC_scaled / LB_TO_KG, 4)} lb CO₂e/ft² · ${fmt(v.EC, 1)} kg per bay</span></div>
<div class="kpi"><span class="muted tiny">Best method (solver)</span><b style="font-size:12.5px">${esc(METHOD_LABELS[res.condition_class] || res.method)}</b><span class="tiny">code ${res.condition_class}${res.method_published !== res.condition_class ? ` (published as ${res.method_published})` : ''}</span></div></div>
${snapshot ? `<div style="margin-top:10px"><img class="snap" src="${snapshot}" alt="3D view of the bay"><div class="tiny muted">3D view at the time of export (colours: the paper's colormap).</div></div>` : ''}
<h3>Members and slab</h3><table>${memberRow('Infill beams', model.infill)}${memberRow('Girders', model.girder)}
<tr><td class="muted">Deck and slab</td><td>${esc(v.selected_deck)} — topping ${fmt(v.selected_deck_topping_thickness, 2)} in${v.Additional_Topping ? ` + ${v.Additional_Topping} in added` : ''}; deck ${fmt(v.selected_deck_SW, 2)} psf; slab ${fmt(v.Final_Slab_SW, 2)} psf</td></tr>
<tr><td class="muted">Framing</td><td>${v.NumInfill} interior infills at ${fmt(v.infill_spacing, 4)} ft; bay area ${fmt(v.bay_area, 0)} ft²</td></tr></table>
<h3>All design states</h3>${statesTable(res)}</div>

<div class="sec pagebreak"><h2>3 · Strength, deflection and selection checks</h2>${C.renderChecks(calcInfo, cap, res.inputs, { mode: res.mode })}</div>
<div class="calc-sec"><h3 style="margin-top:16px">3.1 · Check calculations</h3>${mcNote}${checkCalcs}</div>

<div class="calc-sec pagebreak"><h2>4 · Floor vibration — AISC Design Guide 11 (walking)</h2><div class="small muted" style="margin-bottom:6px">Chapter 4 walking-excitation procedure as coded in the solver (paper Fig. 4), in the solver's order.</div>${vibCalcs}</div>

<div class="sec"><h2>5 · Embodied carbon take-off</h2>
<div class="code-line">${esc(sp.line)}</div>
<table><thead><tr><th>Component</th><th class="right">Take-off mass (lb)</th><th class="right">Factor (kg CO₂e/kg)</th><th class="right">kg CO₂e per bay</th><th class="right">Share</th></tr></thead><tbody>
${sp.parts.map(p => { const mass = { infill: v.steel_w_infill, girder: v.steel_w_girder, deck: v.steel_deck_w, conc: v.conc_w, studs: v.studs_w }[p.key]; const f = { infill: sp.factors.steel, girder: sp.factors.steel, deck: sp.factors.deck, conc: sp.factors.conc, studs: sp.factors.studs }[p.key]; return `<tr><td>${p.label}</td><td class="v">${fmt(mass, 1)}</td><td class="v">${fmt(f, 3)}</td><td class="v">${fmt(p.kg, 2)}</td><td class="v">${fmt(100 * p.kg / sp.sum, 1)} %</td></tr>`; }).join('')}
<tr><td><b>Total</b> (solver EC ${fmt(sp.ec, 4)} ${sp.ok ? '<span class="ok-ic">✓</span>' : '<span class="bad-ic">✗</span>'})</td><td></td><td></td><td class="v">${fmt(sp.sum, 4)}</td><td></td></tr></tbody></table>
<div class="small muted">Masses in lb are converted to kg (× ${v.LB_TO_KG ?? LB_TO_KG}) before the Table 3 factors. Per floor area: ${fmtFixed(v.EC_scaled, 5)} kg CO₂e/ft² = ${fmtFixed(v.EC_scaled * FT2_PER_M2, 4)} kg CO₂e/m² = ${fmtFixed(v.EC_scaled / LB_TO_KG, 5)} lb CO₂e/ft².</div></div>

<div class="sec"><h2>6 · Validation</h2><table>
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

<div class="sec pagebreak"><h2>Appendix B · Every captured engine variable</h2>${C.renderAllVars(cap)}</div>

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
