// Calculations panel (right side): every calculation the solver made for the selected design,
// grouped and collapsed. Opening one shows the solver's own line as a Mathcad-style region
// (symbols := expression, the same with values and units substituted, = the captured value).
import { esc } from '../lib/dom.js';
import { fmt } from '../lib/units.js';
import * as C from './calcs.js';
import { region, symHTML, unitOf, num, splitAssign, parse, one } from './mathcad.js';

const GROUP_ORDER = ['vibration', 'inputs', 'deck', 'comp_II', 'loads_II', 'defl_II', 'nc_II', 'comp_IG', 'loads_IG', 'ltb_IG', 'defl_IG', 'nc_IG', 'selection', 'carbon'];

function memberVal(v, member) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'infill' in v) return one(member === 'girder' ? v.girder : v.infill);
  return one(v);
}

// short value for a collapsed row
function brief(v, unit) {
  if (v === undefined) return '<span class="muted">—</span>';
  if (typeof v === 'boolean') return v ? '<span class="pill pass">true</span>' : '<span class="pill fail">false</span>';
  if (v === null) return '<span class="muted">n/a</span>';
  if (Array.isArray(v)) return `${v.map(x => num(x)).join(' / ')}${unit ? ` <span class="mu">${unit}</span>` : ''}`;
  if (typeof v === 'object') return '<span class="muted">table</span>';
  if (typeof v === 'string') return esc(v);
  return `<b>${num(v)}</b>${unit ? ` <span class="mu">${unit}</span>` : ''}`;
}

// the line that produced the captured value. In order: the line the server re-ran and matched;
// for "x = np.where(case, x_case, x)" chains, the formula of the case that applies (followed to
// x_case); an assignment whose literal equals the value; the last assignment that is not an
// initialiser (zeros_like / full_like) or a reshape of itself.
function pickCode(ci, cap, name, depth = 0) {
  const rc = cap.recheck?.lines || {};
  const line = C.findLine(ci.linesByVar, name, cap);
  if (line && ci.linesByNo[line] && rc[line]?.[0] === true) return { line, code: `${name} = ${ci.linesByNo[line].expr}` };
  const cands = (ci.assignments[name] || []).slice().sort((a, b) => a.line - b.line);
  if (!cands.length) return null;
  const vals = cap.values, v = vals[name];
  for (const c of cands) {
    const sa = splitAssign(c.code);
    const lit = sa ? sa.rhs.split('#')[0].trim() : '';
    if (lit !== '' && Number.isFinite(+lit) && +lit === v) return c;
  }
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i];
    const sa = splitAssign(c.code);
    if (!sa) continue;
    if (/zeros_like|full_like|empty_like|ones_like/.test(sa.rhs)) continue;
    let t = null;
    try { t = parse(sa.rhs); } catch { return c; }
    if (t.t === 'name' && t.v === name) continue;                       // x = x.flatten() etc.
    if (t.t === 'call' && t.fn === 'where' && t.args[2]?.t === 'name' && t.args[2].v === name) {
      const cond = t.args[0].t === 'name' ? vals[t.args[0].v] : undefined;
      const cv = one(cond && typeof cond === 'object' && !Array.isArray(cond) && 'infill' in cond ? (/_IG$/.test(name) ? cond.girder : cond.infill) : cond);
      if (cv === true && t.args[1].t === 'name' && depth < 3) {
        const via = pickCode(ci, cap, t.args[1].v, depth + 1);
        if (via) return { ...via, via: { from: name, to: t.args[1].v, cond: t.args[0].v, line: c.line } };
      }
      if (cv === false) continue;
    }
    return c;
  }
  return line && ci.linesByNo[line] ? { line, code: `${name} = ${ci.linesByNo[line].expr}` } : cands[cands.length - 1];
}

function rcStatus(cap, line) {
  const r = cap.recheck?.lines?.[line];
  if (!r) return '<span class="skip-ic" title="table lookup, reduction across shapes or branch: not re-run at one pair">·</span>';
  if (r[0] === true) return '<span class="ok-ic" title="Re-running this line with the captured inputs reproduces the captured value">✓</span>';
  if (r[0] === false) return '<span class="bad-ic" title="Re-running this line did not reproduce the captured value">✗</span>';
  return '<span class="skip-ic" title="branch not taken">·</span>';
}

function varRegion(ci, cap, name, { member = null, unit } = {}) {
  const pc = pickCode(ci, cap, name);
  if (pc?.via) {
    // x = if(case, x_case, x): show which case applies, then x_case's own formula
    const { from, to, cond, line } = pc.via;
    const head = `<div class="mc-wrap"><div class="mc"><div class="mc-a">${symHTML(from)}</div><div class="mc-o">=</div><div class="mc-b">${symHTML(to)} <span class="mu">since ${esc(cond)} is true</span></div></div></div>
      <div class="mc-src"><a class="mc-ln" data-line="${line}">L${line}</a> <code class="mc-py">${esc((ci.assignments[from] || []).find(c => c.line === line)?.code || '')}</code></div>`;
    return head + varRegion(ci, cap, to, { member, unit: unit || unitOf(to) });
  }
  const r = region({ name, code: pc?.code || null, values: cap.values, orient: cap.orient, member, unit });
  let foot;
  if (!pc) foot = '<span class="muted">Input to the solver (function argument or table value).</span>';
  else {
    const raw = (ci.assignments[name] || []).find(c => c.line === pc.line)?.code || pc.code;
    foot = `${rcStatus(cap, pc.line)} <a class="mc-ln" data-line="${pc.line}" title="Open this line in the solver source">L${pc.line}</a>
      <code class="mc-py">${esc(raw.replace(/\s+/g, ' ').trim())}</code>${r.ok ? '' : ' <span class="muted">(table lookup or branch: shown as the solver\'s code)</span>'}`;
  }
  return `<div class="mc-wrap">${r.html}</div><div class="mc-src">${foot}</div>`;
}

// ---------------------------------------------------------------------------
function buildGroups(ci, cap, mode) {
  const vals = cap.values;
  const groups = [];
  const chk = { id: 'checks', title: 'Strength and deflection checks', blurb: 'LRFD (AISC 360): 1.4D and 1.2D + 1.6L; design strengths φMn / φVn. Construction stage: bare steel, wet concrete, unshored. Pass / fail is the solver\'s own boolean.', items: [] };
  for (const grp of ['infill', 'girder', 'filters']) {
    for (const c of ci.checks[grp]) if (c.flag in vals) chk.items.push({ kind: 'check', grp, c, key: `${grp}:${c.flag}` });
  }
  groups.push(chk);
  const byId = Object.fromEntries(ci.sections.map(s => [s.id, s]));
  const ids = [...GROUP_ORDER.filter(id => byId[id]), ...ci.sections.map(s => s.id).filter(id => !GROUP_ORDER.includes(id))];
  for (const id of ids) {
    const s = byId[id];
    const items = s.items.filter(it => it.var in vals).map(it => ({ kind: 'var', it, key: it.var + (it.member ? ':' + it.member : '') }));
    if (items.length) groups.push({ id, title: s.title, blurb: s.blurb, items });
  }
  return groups;
}

function groupStatus(g, ci, cap) {
  const vals = cap.values;
  if (g.id === 'checks') {
    let fail = 0, n = 0;
    for (const it of g.items) if (it.grp !== 'filters') { n++; if (C.checkRow(it.c, vals).flag === false) fail++; }
    return fail ? `<span class="pill fail">${fail} fail</span>` : `<span class="pill pass">all ${n} pass</span>`;
  }
  if (g.id === 'vibration' && 'vibration_check' in vals) {
    return `<span class="tiny muted">${num(vals.peak_acceleration)} %g</span> ${vals.vibration_check ? '<span class="pill pass">pass</span>' : '<span class="pill fail">fail</span>'}`;
  }
  return '';
}

function itemSummary(item, cap) {
  const vals = cap.values;
  if (item.kind === 'check') {
    const r = C.checkRow(item.c, vals);
    const unit = item.c.unit === 'kip-ft' ? 'kip·ft' : item.c.unit === 'kips' ? 'kip' : item.c.unit;
    const who = item.grp === 'filters' ? 'rule' : item.grp;
    const nums = item.c.kind === 'flag' ? '' : item.c.kind === 'pcc'
      ? `${fmt(r.dem, 1)} % ${r.c.own ? '≥ 25 %' : `≥ ${fmt(r.cap, 0)} %`}`
      : `${num(r.dem)} ${item.c.kind === 'depth' ? '≤' : '≤'} ${num(r.cap)} <span class="mu">${esc(unit)}</span>`;
    const util = r.ratio !== null && Number.isFinite(r.ratio) ? `<span class="cu" title="utilisation">${fmt(r.ratio * 100, 0)}%</span>` : '';
    const pill = r.unknown ? '<span class="pill">n/a</span>' : r.pass ? '<span class="pill pass">✓</span>' : '<span class="pill fail">✗</span>';
    return { label: `${esc(r.c.label)} <span class="ctag">${who}</span>`, right: `${nums ? `<span class="cv">${nums}</span>` : ''}${util}${pill}`, text: `${r.c.label} ${item.c.flag} ${item.c.demand || ''}` };
  }
  const it = item.it;
  const v = memberVal(vals[it.var], it.member);
  const unit = unitOf(it.var) || it.unit || '';
  return {
    label: esc(it.label) + (it.member ? ` <span class="ctag">${it.member}</span>` : ''),
    right: `<span class="cv">${symHTML(it.var, { link: false })} = ${brief(v, unit)}</span>`,
    text: `${it.label} ${it.var} ${(it.symbol || '').replace(/<[^>]+>/g, '')}`,
  };
}

function itemBody(item, ci, cap) {
  const vals = cap.values;
  if (item.kind === 'var') return varRegion(ci, cap, item.it.var, { member: item.it.member, unit: unitOf(item.it.var) || item.it.unit });
  const c = item.c;
  const r = C.checkRow(c, vals);
  let html = '';
  const part = (title, body) => `<div class="mc-part"><div class="mc-pt">${title}</div>${body}</div>`;
  if (c.demand && c.kind !== 'pcc' && c.kind !== 'depth' && c.demand in vals) html += part('Demand', varRegion(ci, cap, c.demand));
  if (c.kind === 'cap' && c.capacity in vals) html += part('Capacity', varRegion(ci, cap, c.capacity));
  if (c.kind === 'pcc' && c.demand in vals) html += part('Composite action the studs can reach', varRegion(ci, cap, c.demand));
  html += part(c.kind === 'flag' ? 'Rule' : 'Check (the solver\'s line)', varRegion(ci, cap, c.flag));
  if (r.ratio !== null && Number.isFinite(r.ratio)) {
    html += `<div class="mc-util">Utilisation ${fmt(r.ratio * 100, 1)} % <div class="ratio-bar"><i style="width:${Math.min(100, r.ratio * 100)}%;background:${r.ratio > 1 ? 'var(--fail)' : r.ratio > 0.9 ? 'var(--warn)' : 'var(--pass)'}"></i></div><span class="muted tiny">${esc(c.clause)}</span></div>`;
  }
  return html;
}

// for the calc report: the same regions, static
//   item: { kind: 'var', it: calcmap item } or { kind: 'check', c: calcmap check, grp }
export function calcItemHTML(item, ci, cap) { return itemBody(item, ci, cap); }

// ---------------------------------------------------------------------------
/**
 * mountCalcs(el, { ci, cap, mode, state, onSource(line), onMissingVar(name) })
 *   state: { open: Set, filter: string } kept by the caller so re-renders keep what is open
 */
export function mountCalcs(el, { ci, cap, mode, state, onSource, onMissingVar }) {
  const groups = buildGroups(ci, cap, mode);
  const q = (state.filter || '').trim().toLowerCase();
  const bodies = new Map();
  let html = `<div class="calc-head"><input class="text-in" id="cpQ" placeholder="Search calculations…" value="${esc(state.filter || '')}" aria-label="Search calculations">
    <button class="btn btn-sm btn-ghost" id="cpAll" title="Open every group">Expand</button><button class="btn btn-sm btn-ghost" id="cpNone" title="Collapse everything">Collapse</button></div>`;
  let shown = 0;
  for (const g of groups) {
    const rows = g.items.map(it => ({ it, s: itemSummary(it, cap) })).filter(({ s }) => !q || s.text.toLowerCase().includes(q));
    if (!rows.length) continue;
    const gk = `g:${g.id}`;
    const gOpen = state.open.has(gk) || (q && rows.length);
    html += `<details class="cgrp" data-k="${gk}"${gOpen ? ' open' : ''}><summary><span class="cg-t">${esc(g.title)}</span><span class="cg-r">${groupStatus(g, ci, cap)}<span class="cg-n">${rows.length}</span></span></summary>
      <div class="cg-b"><div class="cg-blurb">${esc(g.blurb)}</div>`;
    for (const { it, s } of rows) {
      const ik = `i:${g.id}:${it.key}`;
      bodies.set(ik, () => itemBody(it, ci, cap));
      const iOpen = state.open.has(ik);
      const dv = it.kind === 'var' ? it.it.var : it.c.flag;
      html += `<details class="citem" data-k="${ik}" data-var="${esc(dv)}"${iOpen ? ' open' : ''}><summary><span class="ci-l">${s.label}</span><span class="ci-r">${s.right}</span></summary><div class="ci-b">${iOpen ? bodies.get(ik)() : ''}</div></details>`;
      shown++;
    }
    html += '</div></details>';
  }
  if (!shown) html += '<div class="muted small" style="padding:8px 2px">No calculation matches.</div>';
  html += `<div class="tiny muted calc-foot">Each region is the solver's own line: symbols, then the captured inputs with their units, then the captured value. Numbers written into a line (12, 144, 1000, 1728, 386 …) are the solver's unit conversions (in/ft, in²/ft², lb/kip, in³/ft³, g in in/s²). ✓ = the server re-ran that exact line on these inputs and reproduced the value.</div>`;
  el.innerHTML = html;

  const fill = (d) => {
    const b = d.querySelector(':scope > .ci-b');
    if (b && !b.childElementCount && bodies.has(d.dataset.k)) { b.innerHTML = bodies.get(d.dataset.k)(); wire(b); }
  };
  const wire = (root) => {
    root.querySelectorAll('.mv[data-var]').forEach(s => s.onclick = (e) => { e.preventDefault(); e.stopPropagation(); jump(s.dataset.var); });
    root.querySelectorAll('[data-line]').forEach(s => s.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSource?.(+s.dataset.line); });
  };
  el.querySelectorAll('details[data-k]').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) { state.open.add(d.dataset.k); if (d.classList.contains('citem')) fill(d); }
    else state.open.delete(d.dataset.k);
  }));
  wire(el);

  function jump(name) {
    const d = el.querySelector(`details.citem[data-var="${CSS.escape(name)}"]`);
    if (!d) { onMissingVar?.(name); return; }
    const g = d.closest('details.cgrp');
    if (g && !g.open) g.open = true;
    if (!d.open) d.open = true;
    fill(d);
    d.scrollIntoView({ block: 'center', behavior: 'smooth' });
    d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
  }

  const qi = el.querySelector('#cpQ');
  let t;
  qi.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.filter = qi.value;
      mountCalcs(el, { ci, cap, mode, state, onSource, onMissingVar });
      const n = el.querySelector('#cpQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
    }, 200);
  };
  el.querySelector('#cpAll').onclick = () => el.querySelectorAll('details.cgrp').forEach(d => { d.open = true; });
  el.querySelector('#cpNone').onclick = () => el.querySelectorAll('details[data-k]').forEach(d => { d.open = false; });
  return { jump, openGroup: (id) => { const g = el.querySelector(`details.cgrp[data-k="g:${id}"]`); if (g) { g.open = true; g.scrollIntoView({ block: 'start', behavior: 'smooth' }); } } };
}
