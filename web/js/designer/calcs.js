// Calculation inspector: everything shown here is a captured local variable of the
// paper's mitigation_method() at the selected infill/girder pair, next to the line of
// the notebook that computed it. Nothing is recomputed in the browser except the
// display-only carbon split (checked against the solver's EC) and deflection limits
// written inline in the solver's check lines (checked against the solver's booleans).
import { esc } from '../lib/dom.js';
import { fmt, LB_TO_KG } from '../lib/units.js';

export function valueHTML(v, orient, unit = '') {
  if (v === undefined) return '<span class="muted">not computed</span>';
  if (v === null) return '<span class="muted">n/a</span>';
  if (typeof v === 'boolean') return v ? '<span class="pill pass">True</span>' : '<span class="pill fail">False</span>';
  if (orient === 'opt' && Array.isArray(v)) {
    return v.map((x, i) => `<span title="${i + 1} stud${i ? 's' : ''} per rib">${fmt(x, 3)}</span>`).join(' <span class="muted">/</span> ');
  }
  if (orient === 'both' && v && typeof v === 'object' && 'infill' in v) {
    return `<span class="muted tiny">infill</span> ${fmt(v.infill, 4)} <span class="muted tiny">girder</span> ${fmt(v.girder, 4)}`;
  }
  if (orient === 'tbl' && v && typeof v === 'object') {
    if (v.columns) return `<span class="muted">${v.rows.length} row table</span>`;
    return `<span class="muted">table</span>`;
  }
  if (typeof v === 'number') return fmt(v, Math.abs(v) >= 100 ? 2 : 4);
  return esc(String(v));
}

export function pickMember(v, member) {
  if (v && typeof v === 'object' && 'infill' in v) return member === 'girder' ? v.girder : v.infill;
  return v;
}

// highlight variable names in a code line; known ones become clickable
export function codeHTML(code, values, line) {
  const html = esc(code).replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m) =>
    values && m in values && !['np', 'ms'].includes(m) ? `<span class="var" data-var="${m}">${m}</span>` : m);
  return `<div class="code-line">${line ? `<span class="ln" data-line="${line}">L${line}</span>` : ''}${html}</div>`;
}

export function recheckIcon(rc, line) {
  if (!rc || !rc.lines) return '';
  const r = rc.lines[line];
  if (!r) return '<span class="skip-ic" title="not re-evaluable at a single pair (uses a table lookup, reduction or branch)">·</span>';
  if (r[0] === true) return '<span class="ok-ic" title="Re-running this line with the captured inputs reproduces the captured value">✓</span>';
  if (r[0] === false) return '<span class="bad-ic" title="Re-running this line did not reproduce the captured value">✗</span>';
  return '<span class="skip-ic" title="branch not taken for these inputs">·</span>';
}

// ---------------------------------------------------------------------------
export function renderSections(calcmap, cap, { filter = '', lines = {} } = {}) {
  const vals = cap.values, orient = cap.orient;
  const q = filter.trim().toLowerCase();
  let html = '';
  const nav = [];
  for (const sec of calcmap.sections) {
    const rows = sec.items.filter(it => it.var in vals).filter(it => !q ||
      it.var.toLowerCase().includes(q) || it.label.toLowerCase().includes(q) || (it.symbol || '').toLowerCase().includes(q));
    if (!rows.length) continue;
    nav.push(`<a href="#calc-${sec.id}" data-jump="calc-${sec.id}">${esc(sec.title)}</a>`);
    html += `<div class="calc-sec" id="calc-${sec.id}"><h4>${esc(sec.title)}</h4><div class="blurb">${esc(sec.blurb)}</div>
      <table class="calc"><thead><tr><th></th><th>Quantity</th><th>Symbol</th><th class="right">Value</th><th>Unit</th><th>Engine variable</th></tr></thead><tbody>`;
    for (const it of rows) {
      const v = it.member ? pickMember(vals[it.var], it.member) : vals[it.var];
      const o = it.member ? 's' : orient[it.var];
      const last = it.code?.[it.code.length - 1];
      html += `<tr class="calc-row" data-var="${it.var}"><td class="chk">${last ? recheckIcon(cap.recheck, findLine(lines, it.var, cap)) : ''}</td>
        <td>${esc(it.label)}</td><td class="sym">${it.symbol || ''}</td><td class="v">${valueHTML(v, o)}</td>
        <td class="u">${it.unit || ''}</td><td><code>${esc(it.var)}</code>${it.member ? ` <span class="muted tiny">(${it.member})</span>` : ''}</td></tr>`;
    }
    html += '</tbody></table></div>';
  }
  return { html, nav: nav.join('') };
}

// the source line that produced the captured value: prefer a re-evaluated one that matched
export function findLine(lines, v, cap) {
  const cands = lines[v] || [];
  if (!cands.length) return null;
  const rc = cap?.recheck?.lines || {};
  const ok = cands.find(c => rc[c.line] && rc[c.line][0] === true);
  return (ok || cands[cands.length - 1]).line;
}

export function detailHTML(item, cap, calcInfo) {
  const vals = cap.values;
  const code = calcInfo.assignments[item.var] || [];
  const rc = cap.recheck?.lines || {};
  let html = '';
  if (!code.length) html += '<div class="muted small">Input to the solver (function argument or table value) — no assignment line.</div>';
  for (const c of code) {
    const r = rc[c.line];
    const status = r ? (r[0] === true ? '<span class="pill pass">re-run ✓ reproduces value</span>' : r[0] === false ? '<span class="pill fail">re-run differs</span>' : '<span class="pill">branch not taken</span>') : '';
    html += `<div class="row" style="justify-content:space-between;margin-top:4px"><span class="muted tiny">Notebook cell line ${c.line}</span>${status}</div>`;
    html += codeHTML(c.code, vals, c.line);
    const ln = calcInfo.linesByNo[c.line];
    if (ln && ln.inputs.length) {
      html += '<div class="inputs-list">' + ln.inputs.map(nm => `<span><b class="var" data-var="${nm}">${esc(nm)}</b> = ${valueHTML(vals[nm], cap.orient[nm])}</span>`).join('') + '</div>';
    }
  }
  return html;
}

// ---------------------------------------------------------------------------
// limit-state table
// one limit-state row: demand, capacity/limit and the solver's own pass/fail boolean
export function checkRow(c, vals) {
  const L = (kind, span) => kind === 'L360' ? Math.min(span * 12 / 360, 1) : span * 12 / 240;
  let flag = vals[c.flag];
  if (flag && typeof flag === 'object' && 'infill' in flag) flag = c.flag === 'Eco' ? flag.girder : flag.infill;
  let dem = null, cap_ = null, ratio = null, capTxt = '';
  if (c.kind === 'cap') {
    dem = vals[c.demand]; cap_ = vals[c.capacity];
    capTxt = fmt(cap_, 2);
    ratio = Number.isFinite(dem) && Number.isFinite(cap_) && cap_ > 0 ? dem / cap_ : null;
  } else if (c.kind === 'L360' || c.kind === 'L240') {
    dem = vals[c.demand]; const span = vals[c.capacity]; cap_ = L(c.kind, span);
    capTxt = `${fmt(cap_, 3)} <span class="muted tiny">(${c.kind === 'L360' ? 'min(L/360, 1 in)' : 'L/240'})</span>`;
    ratio = Number.isFinite(dem) ? dem / cap_ : null;
  } else if (c.kind === 'pcc' && vals[c.flag === 'PCC_check_II' ? 'studs_II_override' : 'studs_IG_override'] != null) {
    // studs set by the user: the member's own composite action vs the 25 % minimum
    const m = c.flag === 'PCC_check_II' ? 'II' : 'IG';
    const one = (x) => (Array.isArray(x) ? x[0] : x);
    const q = one(vals[`Sigma_Qn_${m}`]), vp = one(vals[`V_prime_${m}`]);
    dem = Number.isFinite(q) && Number.isFinite(vp) && vp > 0 ? 100 * q / vp : null;
    cap_ = 25;
    capTxt = '25 % minimum';
    ratio = Number.isFinite(dem) && dem > 0 ? cap_ / dem : null;
    c = { ...c, label: 'Your studs give at least 25 % composite (and fit in the ribs)', own: true };
  } else if (c.kind === 'pcc') {
    const opts = vals[c.demand];
    dem = Array.isArray(opts) ? Math.max(...opts.filter(Number.isFinite)) : opts;
    cap_ = vals.percent_comp;
    capTxt = `${fmt(cap_, 0)} % requested`;
    ratio = Number.isFinite(dem) && dem > 0 ? cap_ / dem : null;
  } else if (c.kind === 'depth') {
    const di = vals.infill_d, dg = vals.girder_d, k = vals.girder_k;
    dem = di; cap_ = Number.isFinite(dg) && Number.isFinite(k) ? dg - k : null;
    capTxt = `${fmt(cap_, 3)} <span class="muted tiny">(d − k of girder)</span>`;
    ratio = Number.isFinite(dem) && Number.isFinite(cap_) ? dem / cap_ : null;
  }
  const pass = flag === true || flag === 1;
  const unknown = flag === undefined || flag === null;
  return { c, flag, dem, cap: cap_, ratio, capTxt, pass, unknown };
}

export function renderChecks(calcmap, cap, inputs, { mode = 'optimize' } = {}) {
  const vals = cap.values;
  const group = (title, items) => {
    let html = `<h4 style="margin:6px 0 6px">${title}</h4><table class="limit-table"><thead><tr><th>Limit state</th><th class="right">Demand</th><th class="right">Capacity / limit</th><th>Utilisation</th><th>Result</th><th class="muted">Basis</th></tr></thead><tbody>`;
    for (const c0 of items) {
      if (c0.flag && !(c0.flag in vals)) continue;
      const { c, dem, ratio, capTxt, pass, unknown } = checkRow(c0, vals);
      const bar = ratio === null ? '<span class="muted tiny">—</span>' :
        `<div class="row"><div class="ratio-bar" style="flex:1"><i style="width:${Math.min(100, ratio * 100)}%;background:${ratio > 1 ? 'var(--fail)' : ratio > 0.9 ? 'var(--warn)' : 'var(--pass)'}"></i></div><span class="tiny" style="width:42px;text-align:right">${fmt(ratio * 100, 0)}%</span></div>`;
      const demTxt = c.kind === 'pcc' ? (dem === null ? '—' : `${fmt(dem, 1)} % ${capTxt === '25 % minimum' ? 'from your studs' : 'achievable'}`) : c.kind === 'flag' ? '' : fmt(dem, c.unit === 'in' ? 3 : 2);
      html += `<tr><td>${esc(c.label)}${c.unit && c.kind !== 'flag' ? ` <span class="muted tiny">(${c.unit === '%' ? '%' : c.unit})</span>` : ''}</td>
        <td class="right">${demTxt}</td><td class="right">${c.kind === 'flag' ? '' : capTxt}</td><td style="min-width:130px">${c.kind === 'flag' ? '' : bar}</td>
        <td>${unknown ? '<span class="pill">n/a</span>' : pass ? '<span class="pill pass">✓ pass</span>' : '<span class="pill fail">✗ fail</span>'}</td>
        <td class="muted tiny">${esc(c.clause)} · <code>${esc(c.flag)}</code></td></tr>`;
    }
    return html + '</tbody></table>';
  };
  const sp = structuralPass(calcmap, vals);
  let html = `<div class="row" style="gap:14px;flex-wrap:wrap;margin-bottom:10px">
    <span>Strength and deflection: ${sp ? '<span class="pill pass">all pass</span>' : '<span class="pill fail">fail</span>'}</span>
    <span>Vibration (DG 11, a<sub>p</sub>/g ≤ ${vals.tolerance_limit} %g): ${vals.vibration_check === false ? '<span class="pill fail">fails</span>' : '<span class="pill pass">passes</span>'} <span class="muted small">${fmt(vals.peak_acceleration, 3)} %g</span></span></div>
    <div class="muted small" style="margin-bottom:8px">LRFD (AISC 360): demands from 1.4D and 1.2D + 1.6L; capacities are design strengths φM<sub>n</sub> / φV<sub>n</sub>. Construction-stage checks use the bare steel with wet concrete (unshored). Pass / fail is the solver's own boolean for each check (variable on the right); demand, capacity and utilisation are shown for reading.</div>`;
  html += group('Infill beam', calcmap.checks.infill);
  html += group('Girder', calcmap.checks.girder);
  if (mode === 'check') {
    let fails = [];
    for (const c of calcmap.checks.filters) { let f = vals[c.flag]; if (f && typeof f === 'object' && 'infill' in f) f = c.flag === 'Eco' ? f.girder : f.infill; if (f === false) fails.push(c.label.toLowerCase()); }
    html += `<div class="muted small" style="margin-top:12px">Optimizer selection rules (not structural): ${fails.length ? `this pair would not have been picked — ${esc(fails.join('; '))}.` : 'this pair is also a candidate the optimizer could pick.'}</div>`;
  } else {
    html += `<div style="margin-top:14px"></div>` + group('Optimizer selection rules (not structural)', calcmap.checks.filters);
  }
  return html;
}

// structural checks that fail, and optimizer-only filters that fail, for a summary line
export function failingChecks(calcmap, vals) {
  const out = { structural: [], filters: [] };
  for (const grp of ['infill', 'girder', 'filters']) for (const c of calcmap.checks[grp]) {
    let f = vals[c.flag];
    if (f && typeof f === 'object' && 'infill' in f) f = c.flag === 'Eco' ? f.girder : f.infill;
    const own = c.kind === 'pcc' && vals[c.flag === 'PCC_check_II' ? 'studs_II_override' : 'studs_IG_override'] != null;
    const label = own ? 'Your studs give less than 25 % composite or do not fit' : c.label;
    if (f === false) (grp === 'filters' ? out.filters : out.structural).push(grp === 'filters' ? label : `${label} (${grp})`);
  }
  return out;
}

export function structuralPass(calcmap, vals) {
  for (const grp of ['infill', 'girder']) for (const c of calcmap.checks[grp]) {
    let f = vals[c.flag];
    if (f && typeof f === 'object' && 'infill' in f) f = f.infill;
    if (f === false) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// DG 11 chain: the vibration section in flowchart order, with substitutions
const CHAIN = [
  ['Ec', 'Concrete modulus'], ['n', 'Dynamic modular ratio'], ['Ij', 'Infill transformed inertia'],
  ['wj', 'Infill vibration load'], ['DEF_j', 'Infill deflection'], ['fj', 'Beam panel frequency'],
  ['Ds', 'Slab stiffness per unit width'], ['Dj', 'Infill stiffness per unit width'], ['Bj', 'Beam panel width'],
  ['Bj_check', 'Bj ≤ 2/3 floor width (reported only, Bj is not capped)'],
  ['Wj', 'Beam panel weight (× 1.5: infills treated as continuous)'], ['Ig', 'Girder transformed inertia'], ['wg', 'Girder vibration load'],
  ['DEF_g', 'Girder deflection'], ['fg', 'Girder panel frequency'], ['Dg', 'Girder stiffness per unit width'],
  ['Bg', 'Girder panel width'], ['Bg_check', 'Bg ≤ 2/3 floor length (reported only, Bg is not capped)'], ['Wg', 'Girder panel weight'], ['fn', 'Combined floor frequency'],
  ['DEF_g_reduced', 'Reduced girder deflection'], ['W', 'Equivalent panel weight'],
  ['ap_over_g', 'Peak acceleration ratio'], ['peak_acceleration', 'Peak acceleration (%g)'], ['vibration_check', 'Meets tolerance limit'],
];
const UNITS = { Ec: 'ksi', Ij: 'in⁴', wj: 'plf', DEF_j: 'in', fj: 'Hz', Ds: 'in⁴/ft', Dj: 'in⁴/ft', Bj: 'ft', Wj: 'lb', Ig: 'in⁴', wg: 'plf', DEF_g: 'in', fg: 'Hz', Dg: 'in⁴/ft', Bg: 'ft', Wg: 'lb', fn: 'Hz', DEF_g_reduced: 'in', W: 'lb', peak_acceleration: '%g' };

export function renderChain(cap, calcInfo) {
  const vals = cap.values;
  let html = `<div class="muted small" style="margin-bottom:10px">AISC Design Guide 11, Chapter 4 walking-excitation procedure as coded in the solver (paper Fig. 4). Each step is the notebook line that computed it, with the captured inputs substituted. ✓ means re-running that line on those inputs reproduces the solver's value.</div><div class="chain">`;
  CHAIN.forEach(([v, label], i) => {
    if (!(v in vals)) return;
    const line = findLine(calcInfo.linesByVar, v, cap);
    const ln = line && calcInfo.linesByNo[line];
    const code = ln ? `${v} = ${ln.expr}` : (calcInfo.assignments[v]?.slice(-1)[0]?.code || v);
    let sub = '';
    if (ln) {
      sub = ln.expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m) => {
        if (['np', 'ms', 'sqrt', 'e', 'where', 'maximum', 'minimum', 'min', 'max'].includes(m)) return m;
        if (m in vals && typeof vals[m] !== 'object') return typeof vals[m] === 'number' ? fmt(vals[m], 4) : String(vals[m]);
        return m;
      });
    }
    html += `<div class="chain-step"><div class="n">${i + 1}</div><div><div class="eq"><b>${esc(label)}</b></div>
      ${codeHTML(code, vals, line)}${sub ? `<div class="sub">= ${esc(sub)}</div>` : ''}</div>
      <div class="res"><b>${valueHTML(vals[v], cap.orient[v])}</b> <span class="muted small">${UNITS[v] || ''}</span><div>${line ? recheckIcon(cap.recheck, line) : ''}</div></div></div>`;
  });
  return html + '</div>';
}

// ---------------------------------------------------------------------------
// carbon split -- factors read from the solver's own EC line
export function carbonSplit(cap, calcInfo) {
  const v = cap.values;
  const ecLine = (calcInfo.assignments.EC || []).slice(-1)[0]?.code || '';
  const f = (name) => { const m = ecLine.match(new RegExp(name + '\\s*\\*\\s*([\\d.]+)')); return m ? +m[1] : null; };
  const fSteel = f('steel_w'), fDeck = f('steel_deck_w'), fStud = f('studs_w');
  const kg = v.LB_TO_KG ?? LB_TO_KG;
  const conc = v.Conc_ECV;
  const parts = [
    { key: 'infill', label: 'Infill steel', kg: v.steel_w_infill * fSteel * kg, color: '#85C1E9' },
    { key: 'girder', label: 'Girder steel', kg: v.steel_w_girder * fSteel * kg, color: '#FCAE2E' },
    { key: 'deck', label: 'Steel deck', kg: v.steel_deck_w * fDeck * kg, color: '#4178BE' },
    { key: 'conc', label: 'Concrete', kg: v.conc_w * conc * kg, color: '#A3B376' },
  ];
  if (Number.isFinite(v.studs_w)) parts.push({ key: 'studs', label: 'Studs', kg: v.studs_w * fStud * kg, color: '#E57373' });
  const sum = parts.reduce((a, p) => a + (Number.isFinite(p.kg) ? p.kg : 0), 0);
  const ok = Number.isFinite(v.EC) && Math.abs(sum - v.EC) <= 1e-9 * Math.max(1, Math.abs(v.EC)) * 10;
  return { parts, sum, ec: v.EC, ok, factors: { steel: fSteel, deck: fDeck, studs: fStud, conc }, line: ecLine };
}

// Every captured value, grouped as the calculation runs (the calc map's sections), each with what it is, its symbol,
// value and unit, and the notebook line that computes it. Values the calc map does not describe (helper arrays,
// table lookups, flags) follow in one list.
export function renderAllVars(cap, { filter = '', ci = null } = {}) {
  const q = filter.trim().toLowerCase();
  const tag = { s: 'scalar', r: 'infill', c: 'girder', rc: 'pair', opt: '1 / 2 / 3 studs per rib', tbl: 'table', both: 'infill and girder', g: 'module constant' };
  const total = Object.keys(cap.values).length;
  const seen = new Set();
  const hit = (...xs) => !q || xs.some(x => String(x || '').toLowerCase().replace(/<[^>]+>/g, '').includes(q));
  let html = `<div class="vars-intro">These are the values the paper's solver computed for this design, read straight out of
    <code>mitigation_method()</code> at the selected infill and girder (rows ${cap.r} and ${cap.c} of its 273 × 273 shape matrices).
    They are grouped in the order the calculation runs; click a row to see the notebook line that computes it, with its inputs.</div>`;
  let shown = 0;
  for (const sec of ci?.sections || []) {
    const items = sec.items.filter(it => it.var in cap.values && hit(it.label, it.var, it.symbol, sec.title));
    sec.items.forEach(it => seen.add(it.var));
    if (!items.length) continue;
    html += `<h4 class="vars-h">${esc(sec.title)}</h4>${sec.blurb ? `<div class="muted small" style="margin:-2px 0 6px">${esc(sec.blurb)}</div>` : ''}
      <table class="calc vars"><thead><tr><th>Quantity</th><th>Symbol</th><th class="right">Value</th><th>Unit</th><th class="muted">Line</th></tr></thead><tbody>`;
    for (const it of items) {
      const v = pickMember(cap.values[it.var], it.member);
      const line = it.code?.[0]?.line;
      html += `<tr class="calc-row" data-var="${esc(it.var)}"><td>${it.label}${it.member ? ` <span class="muted tiny">(${it.member})</span>` : ''}</td>
        <td>${it.symbol || ''} <code class="muted tiny">${esc(it.var)}</code></td><td class="v">${valueHTML(v, cap.orient[it.var])}</td>
        <td class="muted tiny">${it.unit || ''}</td><td class="muted tiny">${line ? `L${line}` : ''}</td></tr>`;
      shown++;
    }
    html += '</tbody></table>';
  }
  const rest = Object.keys(cap.values).filter(k => !seen.has(k) && hit(k)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (rest.length) {
    const open = q || !ci ? ' open' : '';
    html += `<details class="vars-rest"${open}><summary><b>Other values the solver keeps</b> <span class="muted small">(${rest.length}: helper arrays, table lookups and
      flags that feed the calculations above)</span></summary><table class="calc"><thead><tr><th>Variable</th><th class="right">Value at the pair</th><th>Indexed by</th></tr></thead><tbody>`;
    for (const k of rest) html += `<tr class="calc-row" data-var="${esc(k)}"><td><code>${esc(k)}</code></td><td class="v">${valueHTML(cap.values[k], cap.orient[k])}</td><td class="muted tiny">${tag[cap.orient[k]] || cap.orient[k]}</td></tr>`;
    html += '</tbody></table></details>';
  }
  if (q && !shown && !rest.length) html += `<div class="muted">Nothing matches “${esc(filter)}”.</div>`;
  html += `<div class="muted tiny" style="margin-top:8px">${total} values captured; ${cap.skipped?.length || 0} more are whole-table objects or permuted copies with no single value at this pair.</div>`;
  return html;
}

export function tableHTML(tbl, highlight) {
  if (!tbl || !tbl.columns) return '';
  const cols = tbl.columns;
  const keep = cols.map((c, i) => i).filter(i => !/^\d+ft$/.test(cols[i]) || false);
  return `<div style="overflow:auto;max-height:240px"><table class="calc"><thead><tr>${keep.map(i => `<th>${esc(cols[i])}</th>`).join('')}</tr></thead><tbody>${tbl.rows.map(r => `<tr${highlight && r.includes(highlight) ? ' style="background:color-mix(in srgb,var(--accent) 15%,transparent)"' : ''}>${keep.map(i => `<td>${esc(fmt(r[i], 3))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
