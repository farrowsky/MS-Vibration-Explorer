// Mathcad-style display of the solver's own lines.
//
// Each calculation is the notebook line that computed the captured value, parsed (a small
// Python-expression parser) and drawn as a worksheet region:
//
//     symbol := expression in symbols
//            = the same expression with the captured inputs and their units substituted
//            = the captured value and its unit
//
// Nothing is evaluated here. The substituted numbers are the captured locals at the selected
// pair and the result is the captured value of the target; the ✓ next to a region is the
// server's re-run of that exact line. Unit-conversion constants (12, 1000, 1728, 386 ...) are
// written into the solver's lines and are shown as they are written.
import { esc } from '../lib/dom.js';

// girder arrays keep a trailing axis of 1: show those as the scalar they are
export const one = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);

// ---------------------------------------------------------------------------
// tokenizer + parser (the subset of Python the solver's arithmetic lines use)
// ---------------------------------------------------------------------------
const OPS = ['**', '//', '<=', '>=', '==', '!=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '~', '^', '(', ')', '[', ']', ',', ':', '.', '='];

function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (/\s/.test(c) || c === '\\') { i++; continue; }
    const rest = src.slice(i);
    const num = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(rest);
    if (num) { t.push({ k: 'num', v: num[1] }); i += num[1].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) { t.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      t.push({ k: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new Error(`unexpected "${c}"`);
    t.push({ k: 'op', v: op }); i += op.length;
  }
  return t;
}

export function parse(src) {
  const T = tokenize(src);
  let p = 0;
  const isOp = (v) => T[p] && T[p].k === 'op' && T[p].v === v;
  const isKw = (v) => T[p] && T[p].k === 'id' && T[p].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`expected ${v}`); p++; };
  const bin = (op, a, b) => ({ t: 'bin', op, a, b });

  function ternary() {
    const a = orE();
    if (isKw('if')) {
      p++; const c = orE();
      if (!isKw('else')) throw new Error('expected else');
      p++;
      return { t: 'call', fn: 'where', args: [c, a, ternary()] };
    }
    return a;
  }
  function orE() { let a = andE(); while (isKw('or')) { p++; a = bin('or', a, andE()); } return a; }
  function andE() { let a = notE(); while (isKw('and')) { p++; a = bin('and', a, notE()); } return a; }
  function notE() { if (isKw('not')) { p++; return { t: 'un', op: 'not', a: notE() }; } return cmp(); }
  function cmp() {
    let a = bor();
    while (T[p] && T[p].k === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(T[p].v)) { const op = T[p++].v; a = bin(op, a, bor()); }
    return a;
  }
  function bor() { let a = bxor(); while (isOp('|')) { p++; a = bin('|', a, bxor()); } return a; }
  function bxor() { let a = band(); while (isOp('^')) { p++; a = bin('^', a, band()); } return a; }
  function band() { let a = arith(); while (isOp('&')) { p++; a = bin('&', a, arith()); } return a; }
  function arith() { let a = term(); while (isOp('+') || isOp('-')) { const op = T[p++].v; a = bin(op, a, term()); } return a; }
  function term() { let a = unary(); while (['*', '/', '//', '%'].some(isOp)) { const op = T[p++].v; a = bin(op, a, unary()); } return a; }
  function unary() { if (isOp('-') || isOp('+') || isOp('~')) { const op = T[p++].v; return { t: 'un', op, a: unary() }; } return power(); }
  function power() { const a = postfix(); if (isOp('**')) { p++; return bin('**', a, unary()); } return a; }
  function postfix() {
    let a = atom();
    for (;;) {
      if (isOp('.') && T[p + 1]?.k === 'id') { p++; a = { t: 'attr', a, name: T[p++].v }; }
      else if (isOp('(')) { p++; const { args, kw } = argList(')'); a = { t: 'call', f: a, args, kw }; }
      else if (isOp('[')) { p++; a = { t: 'index', a, idx: subscripts() }; }
      else return a;
    }
  }
  function argList(close) {
    const args = [], kw = {};
    while (!isOp(close)) {
      if (T[p]?.k === 'id' && T[p + 1]?.k === 'op' && T[p + 1].v === '=') { const k = T[p].v; p += 2; kw[k] = ternary(); }
      else args.push(ternary());
      if (isOp(',')) p++; else break;
    }
    expect(close);
    return { args, kw };
  }
  function subscripts() {
    const out = [];
    while (!isOp(']')) {
      if (isOp('.') && T[p + 1]?.v === '.' && T[p + 2]?.v === '.') { p += 3; out.push({ t: 'slice' }); }
      else if (isOp(':')) { p++; if (!isOp(',') && !isOp(']')) ternary(); out.push({ t: 'slice' }); }
      else {
        const e = ternary();
        if (isOp(':')) { p++; if (!isOp(',') && !isOp(']')) ternary(); out.push({ t: 'slice' }); }
        else out.push(e);
      }
      if (isOp(',')) p++; else break;
    }
    expect(']');
    return out;
  }
  function atom() {
    const tk = T[p++];
    if (!tk) throw new Error('unexpected end');
    if (tk.k === 'num') return { t: 'num', v: tk.v };
    if (tk.k === 'str') return { t: 'str', v: tk.v };
    if (tk.k === 'id') {
      if (tk.v === 'True' || tk.v === 'False') return { t: 'bool', v: tk.v === 'True' };
      if (tk.v === 'None') return { t: 'none' };
      return { t: 'name', v: tk.v };
    }
    if (tk.v === '(') {
      if (isOp(')')) { p++; return { t: 'tuple', items: [] }; }
      const a = ternary();
      if (isOp(',')) {
        const items = [a];
        while (isOp(',')) { p++; if (isOp(')')) break; items.push(ternary()); }
        expect(')');
        return { t: 'tuple', items };
      }
      expect(')');
      return a;
    }
    if (tk.v === '[') {
      const items = [];
      while (!isOp(']')) { items.push(ternary()); if (isOp(',')) p++; else break; }
      expect(']');
      return { t: 'tuple', items };
    }
    throw new Error(`unexpected "${tk.v}"`);
  }
  const tree = ternary();
  if (p < T.length) throw new Error('trailing tokens');
  return simplify(tree);
}

// ---------------------------------------------------------------------------
// simplify: drop numpy plumbing that does not change the value at one pair
// ---------------------------------------------------------------------------
const MODS = new Set(['np', 'ms', 'math', 'numpy']);
const IDENTITY_FN = new Set(['array', 'asarray', 'float', 'int', 'float64', 'squeeze', 'ravel']);
const IDENTITY_METHOD = new Set(['flatten', 'reshape', 'astype', 'copy', 'squeeze', 'ravel', 'item']);
const CONSTS = { pi: 'π', e: 'e', nan: 'NaN', inf: '∞', newaxis: null };

function dotted(n) {
  if (n.t === 'name') return n.v;
  if (n.t === 'attr') { const b = dotted(n.a); return b === null ? null : `${b}.${n.name}`; }
  return null;
}

function simplify(n) {
  switch (n.t) {
    case 'attr': {
      const d = dotted(n);
      if (d) {
        const [m, ...rest] = d.split('.');
        if (MODS.has(m) && rest.length === 1 && rest[0] in CONSTS) return { t: 'const', v: rest[0] };
      }
      return { t: 'attr', a: simplify(n.a), name: n.name };
    }
    case 'bin': return { ...n, a: simplify(n.a), b: simplify(n.b) };
    case 'un': return { ...n, a: simplify(n.a) };
    case 'tuple': return { ...n, items: n.items.map(simplify) };
    case 'index': {
      const a = simplify(n.a);
      const keep = n.idx.filter(i => i.t !== 'slice' && !(i.t === 'none') && !(i.t === 'attr' && i.name === 'newaxis'));
      if (!keep.length) return a;
      return { t: 'index', a, idx: keep.map(simplify) };
    }
    case 'call': {
      if (n.fn) return { ...n, args: n.args.map(simplify) };
      const d = dotted(n.f);
      let fn = null;
      if (d) {
        const parts = d.split('.');
        if (parts.length === 1) fn = parts[0];
        else if (parts.length === 2 && MODS.has(parts[0])) fn = parts[1];
      }
      const args = n.args.map(simplify);
      if (fn) {
        if (IDENTITY_FN.has(fn) && args.length >= 1) return args[0];
        if (fn === 'expand_dims' && args.length) return args[0];
        if (fn === 'full_like' && args.length >= 2) return args[1];
        return { t: 'call', fn, args, kw: n.kw };
      }
      if (n.f.t === 'attr' && IDENTITY_METHOD.has(n.f.name)) return simplify(n.f.a);
      return { t: 'call', fn: null, f: simplify(n.f), args, kw: n.kw };
    }
    default: return n;
  }
}

// ---------------------------------------------------------------------------
// symbols: engine name -> Mathcad-style symbol (base + literal subscript)
// _II / _IG mark the infill (j) and the girder (g), as in DG 11
// ---------------------------------------------------------------------------
const SYM = {
  Girder_Span: ['L', 'g'], Infill_Span: ['L', 'j'], Deck_Type: ['h', 'r'], hr: ['h', 'r'], tc: ['t', 'c'],
  conc_density: ['w', 'c'], f_prime_c: ['f′', 'c'], Es: ['E', 's'], Fy: ['F', 'y'], Fu: ['F', 'u'], Ec: ['E', 'c'],
  LL: ['LL', ''], SDL: ['SDL', ''], DL: ['DL', ''], live_load_vibrations: ['LL', 'vib'], dead_load: ['DL', 'vib'],
  tolerance_limit: ['a', 'lim'], DR: ['β', ''], damping_ratio: ['β', ''], percent_comp: ['PCC', ''],
  NumInfill: ['N', 'inf'], NumInfill_unrounded: ['N', 'inf,0'], infill_spacing: ['s', ''], infill_spacing_rounded: ['s', 'table'],
  max_starting_infill_spacing: ['s', 'max'], Conc_Type: ['conc', ''], Building_Use: ['use', ''], Clear_Spans: ['n', 'spans'],
  Additional_Topping: ['Δt', 'c'], Additional_Topping_Load: ['w', 'Δt'], Conc_Load: ['w', 'super'],
  selected_deck_SW: ['w', 'deck'], selected_deck_slab_SW: ['w', 'deck+c'], Final_Slab_SW: ['w', 'slab'],
  selected_deck_topping_thickness: ['t', 'c'], Final_Slab_Thickness: ['t', 'c,tot'], Final_Deck_Slab_Thickness: ['h', 'tot'],
  selected_deck_thickness: ['h', 'r'], Conc_Depth_in_Flute: ['t', 'flute'], effective_conc_depth: ['d', 'e'],
  b_eff: ['b', 'eff'], Vc_prime: ['V′', 'c'], Vs_prime: ['V′', 's'], V_prime: ['V′', ''], Qn: ['Q', 'n'],
  selected_Qn: ['Q', 'n,used'], stud_capacity: ['ΣQ', 'n,studs'], Sigma_Qn: ['ΣQ', 'n'], A_stud: ['A', 'sa'], A: ['A', 's'],
  Rg: ['R', 'g'], Rp: ['R', 'p'], studs_per_rib: ['n', 'rib'], max_studs_half: ['N', 'max,½'], max_PCC: ['PCC', 'max'],
  req_studs_half_filter: ['N', '½'], req_studs: ['N', 'req'], min_req_studs: ['N', 's'], min_studs_per_rib: ['n', 'rib'],
  a_3: ['a', ''], Cc_3: ['C', 'c'], case_label: ['case', ''], Phi_Mn: ['φM', 'n'], Y_ENA: ['Y', 'ENA'], I_LB: ['I', 'LB'],
  Trib: ['b', 'trib'], SW: ['w', 'sw'], W_DL: ['w', 'D'], W_LL: ['w', 'L'], W_TL: ['w', 'T'], W_Con_DL: ['w', 'D,con'],
  W_Con_LL: ['w', 'L,con'], W_CLL: ['w', 'L,comp'], W_PC: ['w', 'u,pc'], V_PC: ['V', 'u,pc'], V_FL: ['V', 'u'],
  M_PC: ['M', 'u,pc'], M_FL: ['M', 'u'], V_DL: ['V', 'D'], V_LL: ['V', 'L'], V_CLL: ['V', 'L,comp'], V_Con_DL: ['V', 'D,con'],
  V: ['V', 'u'], M: ['M', 'u'], Total_SW: ['w', 'sw,inf'], M_SW: ['M', 'sw'], M_DL: ['M', 'D'], M_LL: ['M', 'L'],
  infill_Ix: ['I', 'x,j'], girder_Ix: ['I', 'x,g'], Ix_array: ['I', 'x,g'], Ix: ['I', 'x'],
  DEF_Con: ['Δ', 'con'], camber: ['c', ''], DEF_CDL: ['Δ', 'D'], DEF_CLL: ['Δ', 'L'], DEF_CTL: ['Δ', 'T'], DEF_SW: ['Δ', 'sw'],
  DEF_LL: ['Δ', 'L'], DEF_TL: ['Δ', 'T'], camber_check: ['camber?', ''],
  Lb: ['L', 'b'], Lp: ['L', 'p'], Lr: ['L', 'r'], Cb: ['C', 'b'], PhiMpx: ['φM', 'px'], PhiBF: ['φBF', ''], Fcr: ['F', 'cr'],
  Jc: ['J', 'c'], Sx: ['S', 'x'], rts: ['r', 'ts'], ho: ['h', 'o'], Compact: ['L_b≤L_p', ''],
  Noncompact_LTB: ['φM', 'n,inel'], Slender_LTB: ['φM', 'n,el'], Compact_PhiMn: ['φM', 'n,pl'], Noncompact_PhiMn: ['φM', 'n,inel'],
  Slender_PhiMn: ['φM', 'n,el'], PhiMn_PC: ['φM', 'n,pc'], PhiMn: ['φM', 'n'], PhiVnx: ['φV', 'n'],
  n: ['n', ''], effective_conc_width: ['b', 'e,j'], transformed_conc_width: ['b', 'tr,j'], transformed_conc_area: ['A', 'tr,j'],
  y_bar_infill: ['ȳ', 'j'], infill_depth: ['d', 'j'], infill_area: ['A', 'j'], infill_sw: ['w', 'sw,j'],
  Ij: ['I', 'j'], wj: ['w', 'j'], DEF_j: ['Δ', 'j'], fj: ['f', 'j'], de: ['d', 'e'], Ds: ['D', 's'], Dj: ['D', 'j'], Cj: ['C', 'j'],
  Bj: ['B', 'j'], floor_width: ['W', 'floor'], floor_width_check: ['B', 'j,max'], Bj_check: ['B_j OK', ''], Wj: ['W', 'j'],
  effective_conc_width_girder: ['b', 'e,g'], transformed_conc_width_girder: ['b', 'tr,g'], transformed_conc_area_girder: ['A', 'tr,g'],
  transformed_conc_width_deck: ['b', 'tr,rib'], transformed_conc_area_deck: ['A', 'tr,rib'], y_bar_girder: ['ȳ', 'g'],
  girder_depth: ['d', 'g'], girder_area: ['A', 'g'], girder_sw: ['w', 'sw,g'], Ig: ['I', 'g'], wg: ['w', 'g'], DEF_g: ['Δ', 'g'],
  fg: ['f', 'g'], Dg: ['D', 'g'], Cg: ['C', 'g'], Bg: ['B', 'g'], floor_length: ['L', 'floor'], floor_length_check: ['B', 'g,max'],
  Bg_check: ['B_g OK', ''], Wg: ['W', 'g'], fn: ['f', 'n'], girder_deflection_reduction: ['L_g<B_j', ''], DEF_g_reduced: ['Δ′', 'g'],
  W: ['W', ''], ap_over_g: ['a', 'p'], peak_acceleration: ['a', 'p'], vibration_check: ['vib OK', ''],
  bay_area: ['A', 'bay'], steel_w_infill: ['m', 'steel,j'], steel_w_girder: ['m', 'steel,g'], steel_w: ['m', 'steel'],
  steel_deck_w: ['m', 'deck'], per_stud_w: ['m', 'stud'], studs_w_infill: ['m', 'studs,j'], studs_w_girder: ['m', 'studs,g'],
  studs_w: ['m', 'studs'], conc_w: ['m', 'conc'], Conc_ECV: ['ECF', 'c'], EC: ['EC', ''], EC_scaled: ['EC', 'A'], LB_TO_KG: ['k', 'lb→kg'],
  pre_composite_V_check: ['OK', 'V,pc'], pre_composite_M_check: ['OK', 'M,pc'], composite_V_check: ['OK', 'V'], composite_M_check: ['OK', 'M'],
  DL_DEF_check: ['OK', 'ΔD'], LL_DEF_check: ['OK', 'ΔL'], TL_DEF_check: ['OK', 'ΔT'], PCC_check: ['OK', 'PCC'], PCC_check_flat: ['OK', 'PCC'],
  depth_check: ['OK', 'depth'], combined_check: ['OK', 'pair'], final_check: ['OK', 'cand'], Eco: ['Eco', ''], mask: ['lightest', ''],
  d: ['d', ''], tw: ['t', 'w'], tf: ['t', 'f'], bf: ['b', 'f'], k: ['k', ''], kdes: ['k', 'des'], Zx: ['Z', 'x'],
  Flex_Check: ['OK', 'M'], Shear_Sizes: ['OK', 'V'], Flex_Sizes: ['OK', 'M'],
};
const GREEK = { DEF: 'Δ', Delta: 'Δ', Phi: 'φ', phi: 'φ', Sigma: 'Σ', beta: 'β', Case: 'case' };

// split an engine name into its base, the member it belongs to and any extra subscripts
function splitName(name) {
  let base = name, member = '', extra = [];
  const mm = /_(II|IG)(?=_|$)/.exec(base);
  if (mm) { member = mm[1] === 'II' ? 'j' : 'g'; base = base.slice(0, mm.index) + base.slice(mm.index + mm[0].length); }
  const lc = /_(LC\d)$/.exec(base);
  if (lc) { extra.push(lc[1]); base = base.slice(0, lc.index); }
  const cs = /_(\d[ab]?)$/.exec(base);
  if (cs && !(base in SYM)) { extra.push(cs[1]); base = base.slice(0, cs.index); }
  return { base, member, extra };
}

export function symParts(name) {
  const { base, member, extra } = splitName(name);
  let b, sub;
  if (SYM[base]) [b, sub] = SYM[base];
  else if (SYM[name]) [b, sub] = SYM[name];
  else {
    const tk = base.split('_').filter(Boolean);
    let first = tk.shift() || base;
    const dg = /^([A-Za-z]+?)(\d+)$/.exec(first);
    if (GREEK[first]) first = GREEK[first];
    else if (dg) { first = dg[1]; tk.unshift(dg[2]); }
    b = first; sub = tk.join(',');
  }
  const subs = [sub, ...extra, member].filter(Boolean);
  return { b, sub: subs.join(',') };
}

export function symHTML(name, { link = true } = {}) {
  const { b, sub } = symParts(name);
  const inner = `<i>${esc(b)}</i>${sub ? `<sub>${esc(sub)}</sub>` : ''}`;
  return link ? `<span class="mv" data-var="${esc(name)}" title="${esc(name)}">${inner}</span>` : `<span class="mv">${inner}</span>`;
}

// ---------------------------------------------------------------------------
// units (the solver's working units; most lines convert inline)
// ---------------------------------------------------------------------------
const U = {
  Girder_Span: 'ft', Infill_Span: 'ft', Deck_Type: 'in', hr: 'in', tc: 'in', conc_density: 'pcf', f_prime_c: 'ksi', Es: 'ksi',
  Fy: 'ksi', Fu: 'ksi', Ec: 'ksi', LL: 'psf', SDL: 'psf', DL: 'psf', live_load_vibrations: 'psf', dead_load: 'psf',
  tolerance_limit: '%g', percent_comp: '%', infill_spacing: 'ft', infill_spacing_rounded: 'ft', max_starting_infill_spacing: 'ft',
  Additional_Topping: 'in', Additional_Topping_Load: 'psf', Conc_Load: 'psf', selected_deck_SW: 'psf', selected_deck_slab_SW: 'psf',
  Final_Slab_SW: 'psf', selected_deck_topping_thickness: 'in', Final_Slab_Thickness: 'in', Final_Deck_Slab_Thickness: 'in',
  selected_deck_thickness: 'in', Conc_Depth_in_Flute: 'in', effective_conc_depth: 'in', b_eff: 'in', Qn: 'kip', selected_Qn: 'kip',
  stud_capacity: 'kip', Sigma_Qn: 'kip', A_stud: 'in²', A: 'in²', a_3: 'in', a: 'in', Cc_3: 'kip', Y_ENA: 'in', I_LB: 'in⁴',
  d1: 'in', d3: 'in', d: 'in', tw: 'in', tf: 'in', bf: 'in', k: 'in', kdes: 'in', Zx: 'in³', Trib: 'ft', SW: 'plf', Total_SW: 'klf', infill_Ix: 'in⁴', girder_Ix: 'in⁴', Ix_array: 'in⁴', Ix: 'in⁴',
  camber: 'in', Lb: 'ft', Lp: 'ft', Lr: 'ft', PhiMpx: 'kip·ft', PhiBF: 'kip', Fcr: 'ksi', Jc: 'in⁴', Sx: 'in³', rts: 'in', ho: 'in',
  Noncompact_LTB: 'kip·ft', Slender_LTB: 'kip·ft', PhiVnx: 'kip', effective_conc_width: 'in', transformed_conc_width: 'in',
  transformed_conc_area: 'in²', y_bar_infill: 'in', infill_depth: 'in', infill_area: 'in²', infill_sw: 'plf', Ij: 'in⁴', wj: 'plf',
  fj: 'Hz', de: 'in', Ds: 'in⁴/ft', Dj: 'in⁴/ft', Bj: 'ft', floor_width: 'ft', floor_width_check: 'ft', Wj: 'lb',
  effective_conc_width_girder: 'in', transformed_conc_width_girder: 'in', transformed_conc_area_girder: 'in²',
  transformed_conc_width_deck: 'in', transformed_conc_area_deck: 'in²', y_bar_girder: 'in', girder_depth: 'in', girder_area: 'in²',
  girder_sw: 'plf', Ig: 'in⁴', wg: 'plf', fg: 'Hz', Dg: 'in⁴/ft', Bg: 'ft', floor_length: 'ft', floor_length_check: 'ft', Wg: 'lb',
  fn: 'Hz', W: 'lb', peak_acceleration: '%g', bay_area: 'ft²', steel_w_infill: 'lb', steel_w_girder: 'lb', steel_w: 'lb',
  steel_deck_w: 'lb', per_stud_w: 'lb', studs_w_infill: 'lb', studs_w_girder: 'lb', studs_w: 'lb', conc_w: 'lb',
  Conc_ECV: 'kg CO₂e/kg', EC: 'kg CO₂e', EC_scaled: 'kg CO₂e/ft²', LB_TO_KG: 'kg/lb',
};

export function unitOf(name) {
  if (U[name] !== undefined) return U[name];
  const { base } = splitName(name);
  if (U[base] !== undefined) return U[base];
  if (/^(Vc|Vs|V)_prime/.test(base)) return 'kip';
  if (/^Y\d|^Y_/.test(base)) return 'in';
  if (/^Phi_?Mn|PhiMn$|_LTB$/.test(base)) return 'kip·ft';
  if (/^DEF_/.test(base)) return 'in';
  if (/^W_/.test(base)) return 'klf';
  if (/^V_/.test(base)) return 'kip';
  if (/^M_/.test(base)) return 'kip·ft';
  return '';
}

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------
export function num(v) {
  if (v === null || v === undefined) return 'NaN';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v !== 'number') return esc(String(v));
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : (v > 0 ? '∞' : '−∞');
  const a = Math.abs(v);
  if (Number.isInteger(v) && a < 1e7) return String(v).replace('-', '−');
  if (a >= 1e7 || a < 1e-4) {
    const [m, e] = v.toExponential(3).split('e');
    return `${String(+m).replace('-', '−')}·10<sup>${+e}</sup>`;
  }
  return String(+v.toPrecision(4)).replace('-', '−');
}

// ---------------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------------
const PR = { or: 1, and: 2, not: 3, cmp: 4, bor: 5, bxor: 6, band: 7, add: 8, qty: 8.5, mul: 9, un: 10, frac: 10.5, pow: 11, atom: 13 };
const CMP = { '<=': '≤', '>=': '≥', '==': '=', '!=': '≠', '<': '&lt;', '>': '&gt;' };

const op = (s) => `<span class="mo">${s}</span>`;
const paren = (r) => r.tall
  ? `<span class="mpar"><span class="mpl"></span><span class="mpi">${r.h}</span><span class="mpr"></span></span>`
  : `(${r.h})`;
const fn = (name, args) => ({ h: `<span class="mf">${name}</span>(${args.map(a => a.h).join(', ')})`, p: PR.atom, tall: args.some(a => a.tall) });

class Ctx {
  constructor({ values = {}, orient = {}, member = null, substitute = false } = {}) {
    Object.assign(this, { values, orient, member, substitute, used: 0, unknown: false });
  }
  value(name) {
    if (!(name in this.values)) return undefined;
    let v = this.values[name];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('infill' in v) {
        const m = this.member || (/_IG\b|girder/.test(name) ? 'girder' : 'infill');
        v = m === 'girder' ? v.girder : v.infill;
      } else return undefined;
    }
    if (this.orient[name] === 'tbl') return undefined;
    return one(v);
  }
}

function leaf(name, cx) {
  if (!cx.substitute) return { h: symHTML(name), p: PR.atom };
  const v = cx.value(name);
  if (v === undefined) return { h: symHTML(name), p: PR.atom };
  cx.used++;
  const u = typeof v === 'boolean' || typeof v === 'string' || v === null || Number.isNaN(v) ? '' : unitOf(name);
  const uh = u ? `<span class="mu">${u}</span>` : '';
  if (Array.isArray(v)) {
    const h = `<span class="mvec">${v.map(x => `<span>${num(x)}</span>`).join('')}</span>${uh}`;
    return { h: `<span class="mq">${h}</span>`, p: u ? PR.qty : PR.atom, tall: true };
  }
  if (typeof v === 'string') return { h: `<span class="ms">“${esc(v)}”</span>`, p: PR.atom };
  const neg = typeof v === 'number' && v < 0;
  return { h: `<span class="mq">${num(v)}${uh}</span>`, p: u ? PR.qty : neg ? PR.un : PR.atom };
}

function wrap(r, need) { return r.p < need ? { h: paren(r), p: PR.atom, tall: r.tall } : r; }

function R(n, cx) {
  switch (n.t) {
    case 'num': return { h: `<span class="mn">${n.v}</span>`, p: PR.atom };
    case 'bool': return { h: `<span class="mf">${n.v ? 'true' : 'false'}</span>`, p: PR.atom };
    case 'none': return { h: '<span class="mf">none</span>', p: PR.atom };
    case 'str': cx.unknown = true; return { h: `<span class="ms">“${esc(n.v)}”</span>`, p: PR.atom };
    case 'const': return { h: n.v === 'pi' ? '<i>π</i>' : n.v === 'e' ? '<i>e</i>' : n.v === 'inf' ? '∞' : 'NaN', p: PR.atom };
    case 'name': return leaf(n.v, cx);
    case 'tuple': { const it = n.items.map(x => R(x, cx)); return { h: `(${it.map(x => x.h).join(', ')})`, p: PR.atom, tall: it.some(x => x.tall) }; }
    case 'un': {
      const a = R(n.a, cx);
      if (n.op === '+') return a;
      if (n.op === '-') { const w = wrap(a, PR.un); return { h: `${op('−')}${w.h}`, p: PR.un, tall: a.tall }; }
      const w = wrap(a, PR.un);
      return { h: `${op('¬')}${w.h}`, p: PR.un, tall: a.tall };
    }
    case 'bin': return binary(n, cx);
    case 'call': return call(n, cx);
    case 'index': {
      const a = wrap(R(n.a, cx), PR.atom);
      const ix = n.idx.map(i => (i.t === 'num' ? i.v : (cx.unknown = true, '…'))).join(',');
      return { h: `${a.h}<sub class="mix">⟨${ix}⟩</sub>`, p: PR.atom, tall: a.tall };
    }
    case 'attr': cx.unknown = true; return { h: `${R(n.a, cx).h}.${esc(n.name)}`, p: PR.atom };
    default: cx.unknown = true; return { h: '?', p: PR.atom };
  }
}

function binary(n, cx) {
  const o = n.op;
  if (o === '/') {
    const a = R(n.a, cx), b = R(n.b, cx);
    return { h: `<span class="mfr"><span class="mnu">${a.h}</span><span class="mde">${b.h}</span></span>`, p: PR.frac, tall: true };
  }
  if (o === '//') {
    const a = R(n.a, cx), b = R(n.b, cx);
    const fr = `<span class="mfr"><span class="mnu">${a.h}</span><span class="mde">${b.h}</span></span>`;
    return { h: `<span class="mflr">${fr}</span>`, p: PR.atom, tall: true };
  }
  if (o === '**') {
    const bse = n.a.t === 'const' && n.a.v === 'e' ? { h: '<i>e</i>', p: PR.atom } : wrap(R(n.a, cx), PR.pow + 0.5);
    const ex = R(n.b, cx);
    return { h: `${bse.h}<sup class="mexp">${ex.h}</sup>`, p: PR.pow, tall: bse.tall };
  }
  const table = {
    '+': [PR.add, '+'], '-': [PR.add, '−'], '*': [PR.mul, '·'], '%': [PR.mul, ' mod '],
    '&': [PR.band, '∧'], and: [PR.and, '∧'], '|': [PR.bor, '∨'], or: [PR.or, '∨'], '^': [PR.bxor, '⊕'],
  };
  if (o in CMP) {
    const a = wrap(R(n.a, cx), PR.cmp + 0.5), b = wrap(R(n.b, cx), PR.cmp + 0.5);
    return { h: `${a.h}${op(CMP[o])}${b.h}`, p: PR.cmp, tall: a.tall || b.tall };
  }
  const [pr, sym] = table[o] || [PR.mul, esc(o)];
  // a mixed quantity (value + unit) inside a product reads better in brackets
  const needA = pr === PR.mul ? PR.mul : pr;
  const needB = pr === PR.mul || o === '-' ? pr + 0.5 : pr;
  const a = wrap(R(n.a, cx), needA), b = wrap(R(n.b, cx), needB);
  return { h: `${a.h}${op(sym)}${b.h}`, p: pr, tall: a.tall || b.tall };
}

function call(n, cx) {
  const name = n.fn;
  const args = () => n.args.map(a => R(a, cx));
  if (!name) { cx.unknown = true; return fn(R(n.f, cx).h, args()); }
  switch (name) {
    case 'sqrt': {
      const a = R(n.args[0], cx);
      return { h: `<span class="mrad${a.tall ? ' tall' : ''}"><span class="mrs">√</span><span class="mrb">${a.h}</span></span>`, p: PR.atom, tall: a.tall };
    }
    case 'minimum': case 'min': case 'nanmin': case 'amin': return fn('min', flatArgs(n, cx));
    case 'maximum': case 'max': case 'nanmax': case 'amax': return fn('max', flatArgs(n, cx));
    case 'where': return fn('if', args());
    case 'ceil': { const a = R(n.args[0], cx); return { h: `<span class="mceil">${a.h}</span>`, p: PR.atom, tall: a.tall }; }
    case 'floor': { const a = R(n.args[0], cx); return { h: `<span class="mflr">${a.h}</span>`, p: PR.atom, tall: a.tall }; }
    case 'around': case 'round': return fn('round', args());
    case 'abs': case 'fabs': { const a = R(n.args[0], cx); return { h: `|${a.h}|`, p: PR.atom, tall: a.tall }; }
    case 'exp': { const a = R(n.args[0], cx); return { h: `<i>e</i><sup class="mexp">${a.h}</sup>`, p: PR.pow }; }
    case 'log': return fn('ln', args());
    case 'log10': return fn('log', args());
    case 'isnan': return fn('isNaN', args());
    case 'stack': case 'concatenate': case 'vstack': return fn('', flatArgs(n, cx));
    default: cx.unknown = true; return fn(esc(name), args());
  }
}
// min(np.stack([a, b])) / max([a, b]) -> min(a, b)
function flatArgs(n, cx) {
  const out = [];
  for (const a of n.args) {
    if (a.t === 'tuple') out.push(...a.items.map(x => R(x, cx)));
    else if (a.t === 'call' && ['stack', 'concatenate', 'vstack'].includes(a.fn) && a.args[0]?.t === 'tuple') out.push(...a.args[0].items.map(x => R(x, cx)));
    else out.push(R(a, cx));
  }
  return out;
}

// ---------------------------------------------------------------------------
// one worksheet region for a captured variable
// ---------------------------------------------------------------------------
// split "target = rhs  # comment" (first plain '=')
export function splitAssign(code) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)([\s\S]*)$/.exec(code);
  return m ? { target: m[1], rhs: m[2] } : null;
}

export function resultHTML(v, unit) {
  v = one(v);
  if (typeof v === 'boolean') return v ? '<span class="pill pass mpill">true ✓</span>' : '<span class="pill fail mpill">false ✗</span>';
  if (Array.isArray(v)) return `<span class="mvec">${v.map(x => `<span>${num(x)}</span>`).join('')}</span>${unit ? `<span class="mu">${unit}</span>` : ''}`;
  if (typeof v === 'string') return `<span class="ms">“${esc(v)}”</span>`;
  if (v === undefined) return '<span class="muted">not computed</span>';
  if (v && typeof v === 'object') return '<span class="muted">table</span>';
  return `<b class="mres">${num(v)}</b>${unit ? `<span class="mu">${unit}</span>` : ''}`;
}

/**
 * region({ name, code, values, orient, member, unit })
 *   code: the solver line ("target = expression") or null for an input
 * returns { html, ok } -- ok = false when the line is not plain arithmetic (shown as code)
 */
export function region({ name, code, values, orient, member = null, unit }) {
  const u = unit ?? unitOf(name);
  let v = values[name];
  if (v && typeof v === 'object' && !Array.isArray(v) && 'infill' in v) v = member === 'girder' ? v.girder : v.infill;
  v = one(v);
  const lhs = symHTML(name);
  const res = resultHTML(v, typeof v === 'boolean' ? '' : u);
  const row = (a, o, b, cls = '') => `<div class="mc-a">${a}</div><div class="mc-o">${o}</div><div class="mc-b${cls}">${b}</div>`;
  if (!code) return { html: `<div class="mc">${row(lhs, '=', res)}</div>`, ok: true, input: true };
  const sa = splitAssign(code);
  let tree = null;
  if (sa) { try { tree = parse(sa.rhs); } catch { tree = null; } }
  if (!tree) return { html: `<div class="mc">${row(lhs, '=', res)}</div>`, ok: false };
  const cs = new Ctx({ values, orient, member });
  const sym = R(tree, cs);
  const cv = new Ctx({ values, orient, member, substitute: true });
  const sub = R(tree, cv);
  if (cs.unknown) return { html: `<div class="mc">${row(lhs, '=', res)}</div>`, ok: false };
  const plain = tree.t === 'num' || tree.t === 'const' || tree.t === 'bool';
  let html = row(lhs, ':=', sym.h);
  if (!plain && cv.used) html += row('', '=', sub.h, ' mc-sub');
  if (!plain) html += row('', '=', res);
  return { html: `<div class="mc">${html}</div>`, ok: true };
}
