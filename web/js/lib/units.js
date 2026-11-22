// Unit display. The solver works in imperial units; SI is a display conversion only.
// Carbon: the solver prints kg CO2e per ft2 (lb masses converted to kg before the
// Table 3 factors). The published imperial files hold lb CO2e/ft2 (= kg/ft2 / 0.45359237)
// and the SI files kg CO2e/m2 (= kg/ft2 x 10.763910417). See the release's data/README.md.
export const LB_TO_KG = 0.45359237;
export const FT_TO_M = 0.3048;
export const IN_TO_MM = 25.4;
export const M2_PER_FT2 = 0.09290304;
export const FT2_PER_M2 = 10.763910417;

let system = 'imperial';
const listeners = new Set();
export function getUnits() { return system; }
export function setUnits(s) { system = s; try { localStorage.setItem('msve.units', s); } catch {} listeners.forEach(f => f(s)); }
export function onUnits(f) { listeners.add(f); return () => listeners.delete(f); }
try { const s = localStorage.getItem('msve.units'); if (s === 'si' || s === 'imperial') system = s; } catch {}

export function fmt(v, d = 2) {
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string') return v;
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(3);
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}
export function fmtFixed(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(+v)) return '—';
  return (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const len = {
  ft(v, d = 0) { return system === 'si' ? `${fmtFixed(v * FT_TO_M, d === 0 ? 2 : d + 1)} m` : `${fmtFixed(v, d)} ft`; },
  in(v, d = 2) { return system === 'si' ? `${fmtFixed(v * IN_TO_MM, 0)} mm` : `${fmtFixed(v, d)} in`; },
  ftBoth(v) { return `${fmtFixed(v, 0)} ft (${fmtFixed(v * FT_TO_M, 2)} m)`; },
};

// EC from the solver (kg CO2e / ft2) -> display
export function ecFromSolver(kgPerFt2) {
  if (!Number.isFinite(kgPerFt2)) return { v: NaN, u: '' };
  return system === 'si' ? { v: kgPerFt2 * FT2_PER_M2, u: 'kg CO₂e/m²' } : { v: kgPerFt2 / LB_TO_KG, u: 'lb CO₂e/ft²' };
}
// EC from the published imperial dataset (lb CO2e / ft2) -> display
export function ecFromDataset(lbPerFt2) {
  if (!Number.isFinite(lbPerFt2)) return { v: NaN, u: '' };
  return system === 'si' ? { v: lbPerFt2 * LB_TO_KG * FT2_PER_M2, u: 'kg CO₂e/m²' } : { v: lbPerFt2, u: 'lb CO₂e/ft²' };
}
export function ecUnit() { return system === 'si' ? 'kg CO₂e/m²' : 'lb CO₂e/ft²'; }
export function ecBay(kg) { return system === 'si' ? `${fmt(kg, 0)} kg CO₂e` : `${fmt(kg / LB_TO_KG, 0)} lb CO₂e`; }
