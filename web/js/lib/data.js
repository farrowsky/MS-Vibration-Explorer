// Static data: AISC W-shapes and the published design-space datasets (packed by
// tools/build_web_data.py from the release's data/imperial/*.csv, values unchanged).
let shapesP = null;
export function loadShapes() {
  if (!shapesP) shapesP = fetch('data/shapes.json').then(r => r.json()).then(d => {
    const names = Object.keys(d.shapes);
    return { byName: d.shapes, names };
  });
  return shapesP;
}

const dsP = {};
export function loadDataset(system) {
  if (!dsP[system]) {
    dsP[system] = Promise.all([
      fetch(`data/${system}.json`).then(r => r.json()),
      fetch(`data/${system}.bin`).then(r => r.arrayBuffer()),
      loadShapes(),
    ]).then(([meta, buf, shapes]) => new Dataset(system, meta, buf, shapes));
  }
  return dsP[system];
}

const CTOR = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array };

export class Dataset {
  constructor(system, meta, buf, shapes) {
    this.system = system;
    this.meta = meta;
    this.n = meta.rows;
    this.shapes = shapes;
    this.cols = {};
    for (const c of meta.columns) {
      const A = CTOR[c.dtype];
      const raw = new A(buf, c.offset, this.n);
      this.cols[c.name] = { raw, scale: c.scale || 1, dtype: c.dtype };
    }
    // index rows by input combination
    this.key = new Map();
    const g = this.raw('g'), i = this.raw('i'), conc = this.raw('conc'), deck = this.raw('deck'), pcc = this.raw('pcc');
    for (let r = 0; r < this.n; r++) this.key.set(`${g[r]}|${i[r]}|${conc[r]}|${deck[r]}|${pcc[r]}`, r);
  }
  raw(name) { return this.cols[name].raw; }
  has(name) { return name in this.cols; }
  get(name, r) {
    const c = this.cols[name];
    if (!c) return undefined;
    const v = c.raw[r];
    return c.dtype === 'f32' ? v : v / c.scale;
  }
  shape(name, r) {
    const v = this.cols[name]?.raw[r];
    return v === undefined || v === 65535 ? null : this.shapes.names[v];
  }
  find({ g, i, conc, deck, pcc }) {
    return this.key.get(`${g}|${i}|${conc}|${Math.round(deck * 2)}|${this.system === 'composite' ? pcc : 0}`);
  }
  // the design stored for one state, in the same shape the solver result uses
  state(r, key) {
    const inf = this.shape(`${key}.inf`, r), gir = this.shape(`${key}.gir`, r);
    if (!inf || !gir) return null;
    const out = {
      infill: inf, girder: gir,
      ec_lb_ft2: this.get(`${key}.ec`, r), pa: this.get(`${key}.pa`, r), fn: this.get(`${key}.fn`, r),
    };
    if (this.has(`${key}.inf_studs`)) {
      out.infill_studs = this.get(`${key}.inf_studs`, r);
      out.girder_studs = this.get(`${key}.gir_studs`, r);
      out.infill_camber = this.get(`${key}.inf_camber`, r);
      out.girder_camber = this.get(`${key}.gir_camber`, r);
    }
    if (this.has(`${key}.top`)) out.topping = this.get(`${key}.top`, r);
    if (key === 'conc') out.additional = this.get('conc.add', r);
    return out;
  }
  inputs(r) {
    return { g: this.get('g', r), i: this.get('i', r), conc: this.get('conc', r), deck: this.get('deck', r), pcc: this.get('pcc', r) };
  }
}
