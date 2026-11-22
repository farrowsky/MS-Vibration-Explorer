// The paper's colormap: matplotlib LinearSegmentedColormap.from_list('custom_cmap',
// ['#4178BE', '#85C1E9', '#A3B376', '#FCAE2E', '#E57373']) -- five equally spaced
// stops, linear interpolation in sRGB, exactly as the paper's figures draw it.
export const HEX = ['#4178BE', '#85C1E9', '#A3B376', '#FCAE2E', '#E57373'];
const STOPS = HEX.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

export function rgb(t) {
  if (!Number.isFinite(t)) t = 0;
  t = Math.min(1, Math.max(0, t));
  const x = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export function css(t, alpha = 1) {
  const [r, g, b] = rgb(t);
  return alpha === 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}
export function rgb01(t) { return rgb(t).map(v => v / 255); }
export const GRADIENT = `linear-gradient(90deg, ${HEX.map((h, i) => `${h} ${i * 25}%`).join(', ')})`;

// Categorical colours for mitigation methods, matching the paper's Figure 11 order.
export const METHOD_COLORS = {
  1: '#A3B376',   // passes as built        (Figure 11: green)
  6: '#FCAE2E',   // upsize infills+girders (Figure 11: orange)
  4: '#4178BE',   // add concrete topping   (Figure 11: blue)
  2: '#85C1E9',   // upsize infills (raw engine code, folded into 6 in the paper)
  3: '#E57373',   // upsize girders (raw engine code, folded into 6 in the paper)
  5: '#6b7785',   // none feasible
};
export const METHOD_LABELS = {
  1: 'Passes as built', 2: 'Upsize infills', 3: 'Upsize girders', 4: 'Add concrete topping',
  5: 'No feasible mitigation', 6: 'Upsize steel (infills + girders)',
};

// GLSL source for the same colormap, used by the floor shaders.
export const GLSL = `
vec3 paperCmap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.2549, 0.4706, 0.7451);
  vec3 c1 = vec3(0.5216, 0.7569, 0.9137);
  vec3 c2 = vec3(0.6392, 0.7020, 0.4627);
  vec3 c3 = vec3(0.9882, 0.6824, 0.1804);
  vec3 c4 = vec3(0.8980, 0.4510, 0.4510);
  float x = t * 4.0;
  if (x < 1.0) return mix(c0, c1, x);
  if (x < 2.0) return mix(c1, c2, x - 1.0);
  if (x < 3.0) return mix(c2, c3, x - 2.0);
  return mix(c3, c4, x - 3.0);
}`;
