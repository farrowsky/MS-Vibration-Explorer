// 3D model of one bay, drawn from the solver's own results.
//
// Scene units are feet. Bay coordinates: x along the girders (0..Lg), z along the
// infills (0..Lj), y up, top of steel at y = 0. Every member is built from its AISC
// dimensions (d, bf, tf, tw, k), the deck flute geometry is chosen so its concrete
// volume equals the solver's Conc_Depth_in_Flute, studs follow the solver's count and
// studs-per-rib, and the floor colours/motion use the solver's DG 11 quantities.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { GLSL as CMAP_GLSL } from '../lib/colormap.js';

const IN = 1 / 12;
const PI = Math.PI;

// Deck profiles. Pitch and top opening are the usual SDI/Vulcraft VL values; the bottom
// flat is then set so the average concrete rib width x depth / pitch equals the solver's
// Conc_Depth_in_Flute (0.532414 / 1.0 / 1.5 in), i.e. the drawn concrete volume is the
// volume the carbon take-off counts.
export const DECK = {
  1.5: { pitch: 6, top: 2.5, fill: 0.532414 },
  2: { pitch: 12, top: 7.0, fill: 1.0 },
  3: { pitch: 12, top: 7.25, fill: 1.5 },
};
for (const [hr, d] of Object.entries(DECK)) {
  const avg = d.fill / (+hr) * d.pitch;           // average concrete rib width
  d.bottom = 2 * avg - d.top;
}

// ---------------------------------------------------------------------------
// shared displacement field (injected into every material that moves)
// ---------------------------------------------------------------------------
function makeUniforms() {
  return {
    uOrigin: { value: new THREE.Vector2(0, 0) },
    uLg: { value: 30 }, uLj: { value: 30 },
    uDj: { value: 0.5 }, uDg: { value: 0.5 },
    uAmp: { value: 0 }, uPhase: { value: 0 },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 99, 0)) },
    uTime: { value: 0 },
  };
}

const DISP_GLSL = `
uniform vec2 uOrigin;
uniform float uLg, uLj, uDj, uDg, uAmp, uPhase, uTime;
uniform vec4 uRip[8];
float bayPhi(vec2 p) {
  // members on the bay edges (girders, edge infills) straddle it: a point within 1.5 ft
  // takes the value on the edge, so both halves of a flange move together
  if (p.x < -1.5 || p.y < -1.5 || p.x > uLg + 1.5 || p.y > uLj + 1.5) return 0.0;
  p = clamp(p, vec2(0.0), vec2(uLg, uLj));
  float sx = sin(3.14159265 * p.x / uLg);
  float sz = sin(3.14159265 * p.y / uLj);
  return (uDg * sx + uDj * sz) / max(uDg + uDj, 1e-6);
}
float ripples(vec2 p) {
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i];
    if (r.z > 6.0) continue;
    float d = distance(p, r.xy);
    float front = r.z * 22.0;
    float env = exp(-r.z * 1.6) * smoothstep(front + 2.0, front - 6.0, d) * exp(-max(d - front, 0.0) * 0.6);
    s += r.w * env * sin(1.7 * (d - front));
  }
  return s;
}
`;

function patchDisplacement(mat, U, { ripple = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = DISP_GLSL + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        vec2 bp = wp.xz - uOrigin;
        transformed.y -= uAmp * uPhase * bayPhi(bp) ${ripple ? '+ 0.0' : ''};
      }`);
  };
  mat.customProgramCacheKey = () => 'bayDisp' + (ripple ? 'R' : '');
  mat.userData.disp = true;          // meshes using it get the displaced shadow material too (setModel)
  return mat;
}

// ---------------------------------------------------------------------------
// geometry builders
// ---------------------------------------------------------------------------
function iShape(dm, cope = 0) {
  // AISC W-shape outline, top of steel at y = 0, centred on the web. Inches -> ft.
  const B = dm.bf / 2 * IN, D = dm.d * IN, T = dm.tf * IN, W = dm.tw / 2 * IN;
  const R = Math.max(0, Math.min((dm.kdes - dm.tf), dm.bf / 2 - dm.tw / 2 - 0.05)) * IN;
  const s = new THREE.Shape();
  if (!cope) {
    s.moveTo(-B, 0); s.lineTo(B, 0); s.lineTo(B, -T); s.lineTo(W + R, -T);
    s.quadraticCurveTo(W, -T, W, -T - R); s.lineTo(W, -D + T + R);
    s.quadraticCurveTo(W, -D + T, W + R, -D + T); s.lineTo(B, -D + T); s.lineTo(B, -D);
    s.lineTo(-B, -D); s.lineTo(-B, -D + T); s.lineTo(-W - R, -D + T);
    s.quadraticCurveTo(-W, -D + T, -W, -D + T + R); s.lineTo(-W, -T - R);
    s.quadraticCurveTo(-W, -T, -W - R, -T); s.lineTo(-B, -T); s.closePath();
  } else {
    const c = Math.min(cope, D - T - R - 0.01 * IN);
    s.moveTo(-W, -c); s.lineTo(W, -c); s.lineTo(W, -D + T + R);
    s.quadraticCurveTo(W, -D + T, W + R, -D + T); s.lineTo(B, -D + T); s.lineTo(B, -D);
    s.lineTo(-B, -D); s.lineTo(-B, -D + T); s.lineTo(-W - R, -D + T);
    s.quadraticCurveTo(-W, -D + T, -W, -D + T + R); s.closePath();
  }
  return s;
}

function extrude(shape, length, steps) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: Math.max(1, steps), curveSegments: 4 });
  g.computeVertexNormals();
  return g;
}

function deckProfile(hr, Ljin) {
  // z (in) / y (in) points across the bay, flute (concrete rib) centres at z = k * pitch
  const d = DECK[hr];
  const p = d.pitch, b = d.bottom / 2, t = d.top / 2;
  const pts = [[0, 0]];
  const n = Math.round(Ljin / p);
  for (let k = 0; k < n; k++) {
    const z0 = k * p;
    pts.push([z0 + b, 0], [z0 + t, hr], [z0 + p - t, hr], [z0 + p - b, 0]);
  }
  pts.push([n * p, 0]);
  // close any remainder (spans are whole feet, so this is only a guard)
  if (n * p < Ljin) pts.push([Ljin, 0]);
  return pts;
}

// ---------------------------------------------------------------------------
export class Bay3D {
  constructor(container, opts = {}) {
    this.el = container;
    this.opts = opts;
    this.U = makeUniforms();
    // default: see-through slab so the steel, deck and studs read first. For an interior DG 11 bay the
    // mode-shape overlay always peaks at mid-bay, so it is offered as an option, not the default.
    this.layers = { slab: true, deck: true, studs: true, labels: true, panels: false, columns: true, dims: true, xray: true };
    this.floorMode = 'concrete'; // concrete | mode | accel | defl
    this.motion = 'still';       // still | vibrate | walk
    this.exag = 14;
    this.slow = 0.18;
    this.stepHz = 2.0;
    this.cut = 0;                // 0..1 section along x
    this.model = null;
    this.labels = [];
    this.clock = new THREE.Clock();
    this.tVis = 0;
    this.ripIdx = 0;
    this.walker = null;
    this.walkState = { s: 0, lastStep: 0, side: 1, resp: 0 };
    this.liveAccel = 0;
    this._initRenderer();
  }

  _initRenderer() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      this.failed = true;
      this.el.innerHTML = '<div class="vp-overlay"><div class="webgl-msg">The 3D view needs WebGL, which is not available in this browser. Results, calculations and the report still work.</div></div>';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    this.renderer = renderer;
    this.el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1200);
    this.camera.position.set(42, 30, 48);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = PI * 0.96;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 400;

    scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x2a3440, 0.95));
    // a soft studio environment (sky gradient + bright band) so steel and galvanised deck read as metal
    {
      const env = new THREE.Scene();
      const geo = new THREE.SphereGeometry(50, 48, 24);
      const col = [];
      const pos = geo.attributes.position;
      const top = new THREE.Color(0xe8f0f8), mid = new THREE.Color(0xffffff), low = new THREE.Color(0x3a4654), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 50;
        if (y > 0.15) c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.85));
        else c.copy(low).lerp(mid, Math.max(0, (y + 0.4) / 0.55));
        col.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(env, 0.02).texture;
      scene.environmentIntensity = 0.55;
      pm.dispose();
    }
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(30, 60, 24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    this.sun = sun;
    const rim = new THREE.DirectionalLight(0x85c1e9, 0.6);
    rim.position.set(-40, 20, -30);
    scene.add(rim);

    // no ground or grid: the view shows the bay only

    this.root = new THREE.Group();
    scene.add(this.root);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels-layer';
    this.el.append(this.labelLayer);

    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.el);
    this._resize();

    renderer.domElement.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this._down) return;
      const moved = Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]);
      this._down = null;
      if (moved < 5) this._click(e);
    });
    renderer.domElement.addEventListener('pointermove', (e) => this._hover(e));

    this._mats();
    renderer.setAnimationLoop(() => this._frame());
  }

  _mats() {
    const U = this.U;
    const std = (o) => patchDisplacement(new THREE.MeshStandardMaterial(o), U);
    this.mat = {
      girder: std({ color: 0xd98f2b, metalness: 0.3, roughness: 0.5 }),
      infill: std({ color: 0x5b93d9, metalness: 0.3, roughness: 0.5 }),
      edge: std({ color: 0x4a7fbf, metalness: 0.3, roughness: 0.52 }),
      deck: std({ color: 0xc9d0d6, metalness: 0.6, roughness: 0.38, side: THREE.DoubleSide }),
      conc: std({ color: 0xb7b4ad, metalness: 0.0, roughness: 0.92, side: THREE.DoubleSide }),
      stud: std({ color: 0xe8e2d4, metalness: 0.85, roughness: 0.28 }),
      column: new THREE.MeshStandardMaterial({ color: 0x8b98a5, metalness: 0.3, roughness: 0.6, transparent: true, opacity: 0.28, depthWrite: false }),
      hl: std({ color: 0xffffff, emissive: 0x85c1e9, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 }),
      // section-cut faces: self-lit so the cut reads clearly from any side
      // (displaced with the floor so the cut moves with it)
      capConc: std({ color: 0xd8d4cb, emissive: 0x6b6861, roughness: 0.95, side: THREE.DoubleSide }),
      capSteel: std({ color: 0xf0a640, emissive: 0x6a3f0c, roughness: 0.6, side: THREE.DoubleSide }),
    };
    for (const k of ['girder', 'infill', 'edge', 'deck', 'conc', 'stud', 'hl']) this.mat[k].clippingPlanes = [this.clipPlane];
    // shadows are drawn with a depth material: give it the same displacement, so shadows move with the floor
    this.mat.depthDisp = patchDisplacement(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U);
    this.mat.depthDisp.clippingPlanes = [this.clipPlane];
    this.mat.conc.polygonOffset = true;
    this.mat.conc.polygonOffsetFactor = 1;

    // floor surface: GPU colormap of the solver's DG 11 quantities
    this.floorU = {
      ...U,
      uMode: { value: 1 }, uAp: { value: 0 }, uLimit: { value: 0.5 }, uVmax: { value: 1 },
      uDtot: { value: 1 }, uCut: { value: -1 }, uXray: { value: 0 }, uLight: { value: new THREE.Vector3(0.45, 0.85, 0.35).normalize() },
      uHover: { value: new THREE.Vector3(0, 0, -1) },
    };
    this.mat.floor = new THREE.ShaderMaterial({
      uniforms: this.floorU,
      transparent: true,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
      vertexShader: DISP_GLSL + `
        varying vec3 vW; varying vec2 vB;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 bp = wp.xz - uOrigin;
          float ph = bayPhi(bp);
          wp.y -= uAmp * uPhase * ph;
          wp.y += ripples(bp) * 0.05;
          vW = wp.xyz; vB = bp;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: CMAP_GLSL + DISP_GLSL + `
        uniform int uMode; uniform float uAp, uLimit, uVmax, uDtot, uCut, uXray; uniform vec3 uLight, uHover;
        varying vec3 vW; varying vec2 vB;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
        void main() {
          if (vB.x < uCut) discard;
          vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
          if (n.y < 0.0) n = -n;
          float lam = 0.55 + 0.45 * max(dot(n, uLight), 0.0);
          float ph = bayPhi(vB);
          vec3 col; float alpha = 1.0;
          if (uMode == 0) {
            float g = 0.70 + 0.06 * noise(vB * 3.0) + 0.04 * noise(vB * 17.0);
            col = vec3(g, g * 0.985, g * 0.95);
          } else {
            float val = uMode == 1 ? ph : (uMode == 2 ? uAp * ph : uDtot * ph);
            float t = uMode == 1 ? ph : val / max(uVmax, 1e-6);
            col = paperCmap(t);
            if (uMode == 2) {
              // peak acceleration: the paper's colours up to orange, red at the tolerance limit,
              // then darker red the further above it (dark at uVmax)
              float tl = val / max(uLimit, 1e-6);
              vec3 red = vec3(0.84, 0.15, 0.15), dark = vec3(0.23, 0.01, 0.01);
              if (tl <= 0.8) col = paperCmap(tl / 0.8 * 0.75);
              else if (tl <= 1.0) col = mix(paperCmap(0.75), red, (tl - 0.8) / 0.2);
              else col = mix(red, dark, clamp((val - uLimit) / max(uVmax - uLimit, 1e-6), 0.0, 1.0));
            }
            // iso-lines every 10 %
            float f = t * 10.0;
            float w = fwidth(f);
            float iso = 1.0 - smoothstep(0.0, w * 1.2, abs(fract(f + 0.5) - 0.5));
            col = mix(col, col * 0.62, iso * 0.55);
            if (uMode == 2) {
              // tolerance contour + hatching where the modal distribution exceeds the limit
              float e = val - uLimit;
              float wl = fwidth(val);
              float ring = 1.0 - smoothstep(0.0, wl * 1.6, abs(e));
              col = mix(col, vec3(1.0), ring * 0.95);
            }
          }
          // ripple glint
          float rp = ripples(vB);
          col += vec3(0.55, 0.75, 0.95) * abs(rp) * 0.7;
          // hover ring
          if (uHover.z > 0.0) {
            float d = distance(vB, uHover.xy);
            col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.08, abs(d - 0.9))) * 0.85);
          }
          // 1 ft grid, very faint
          vec2 gq = abs(fract(vB) - 0.5);
          float gl = 1.0 - smoothstep(0.0, fwidth(vB.x) * 1.2, min(0.5 - gq.x, 0.5 - gq.y));
          col = mix(col, col * 0.88, gl * 0.25);
          col *= lam;
          if (uXray > 0.5) alpha = uMode == 0 ? 0.22 : 0.88;
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }`,
    });
  }

  _resize() {
    if (!this.renderer) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  setModel(m, { animateIn = true } = {}) {
    if (this.failed) return;
    const first = !this.model;
    const sameFrame = this.model && this.model.Lg === m.Lg && this.model.Lj === m.Lj;
    this.model = m;
    this._build(m);
    if (first || !sameFrame) this.setView(this.view || 'iso', !first);
    if (animateIn) this._growT = 0;
  }

  _clear() {
    this.root.traverse((o) => { if (o.geometry && !o.userData.keepGeo) o.geometry.dispose(); });
    this.root.clear();
    this.labels.forEach(l => l.el.remove());
    this.labels = [];
    this.pickables = [];
  }

  _build(m) {
    this._clear();
    const U = this.U;
    const Lg = m.Lg, Lj = m.Lj;
    U.uLg.value = Lg; U.uLj.value = Lj;
    U.uOrigin.value.set(-Lg / 2, -Lj / 2);
    this.root.position.set(-Lg / 2, 0, -Lj / 2);
    // fit the sun's shadow camera to this bay (three.js defaults to a 10 x 10 box, which shadowed only the middle)
    const sc = this.sun.shadow.camera, half = 0.5 * Math.hypot(Lg, Lj) + 4;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = this.sun.position.length() + half * 2;
    sc.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
    const vib = m.vib || {};
    U.uDj.value = Number.isFinite(vib.dj) ? vib.dj : 0.5;
    U.uDg.value = Number.isFinite(vib.dg) ? vib.dg : 0.5;
    this.floorU.uAp.value = vib.ap || 0;
    this.floorU.uLimit.value = vib.limit || 0.5;
    this.floorU.uVmax.value = Math.max(vib.ap || 0, 2 * (vib.limit || 0.5));
    this.floorU.uDtot.value = (vib.dj || 0) + (vib.dg || 0);
    this._applyFloorMode();

    const G = new THREE.Group();
    this.root.add(G);
    this.members = new THREE.Group();
    G.add(this.members);

    const gd = m.girder.dims, id = m.infill.dims;
    // ---- columns (context only, not designed) ----
    const colDims = { d: 14.0, bf: 14.5, tf: 0.71, tw: 0.44, kdes: 1.31 };
    this.columns = new THREE.Group();
    // short stubs, about 3 ft above and below the floor (always at least 1 ft below the girder)
    const colTop = 3, colBot = Math.max(3, gd.d * IN + 1);
    for (const [x, z] of [[0, 0], [Lg, 0], [0, Lj], [Lg, Lj]]) {
      const g = extrude(iShape(colDims), colTop + colBot, 1);
      g.translate(0, colDims.d / 2 * IN, 0);   // centre the section on the grid point
      const c = new THREE.Mesh(g, this.mat.column);
      c.rotation.x = PI / 2;                   // extrusion (z) -> down (-y)
      c.position.set(x, colTop, z);
      this.columns.add(c);
    }
    this.columns.visible = this.layers.columns;
    G.add(this.columns);

    // members stop 1/2 in short of the column outline (context columns are W14X90)
    const colHalfX = Math.max(colDims.d, colDims.bf) / 2 * IN + 0.5 * IN;
    const colHalfZ = colHalfX;

    // ---- girders (along x) at z = 0 and z = Lj ----
    const gLen = Lg - 2 * colHalfX;
    for (const z of [0, Lj]) {
      const geo = extrude(iShape(gd), gLen, Math.ceil(Lg * 1.5));
      const mesh = new THREE.Mesh(geo, this.mat.girder);
      mesh.rotation.y = PI / 2;
      mesh.position.set(colHalfX, 0, z);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { kind: 'girder' };
      this.members.add(mesh);
      this.pickables.push(mesh);
    }

    // solid caps for the girders at the section cut
    this.girderCaps = new THREE.Group();
    const gcap = new THREE.ShapeGeometry(iShape(gd), 4);
    for (const z of [0, Lj]) {
      const c = new THREE.Mesh(gcap, this.mat.capSteel);
      c.rotation.y = -PI / 2;
      c.position.z = z;
      c.userData.keepGeo = z !== 0;
      this.girderCaps.add(c);
    }
    this.girderCaps.visible = false;
    G.add(this.girderCaps);

    // ---- infills (along z) ----
    const N = m.N, s = m.s;
    const xs = [];
    for (let k = 0; k <= N + 1; k++) xs.push(k * s);
    const webFace = gd.tw / 2 * IN + 0.5 * IN;
    const copeLen = Math.max(0, (gd.bf / 2 - gd.tw / 2) * IN + 0.75 * IN);
    const copeDepth = (gd.kdet || gd.kdes) * IN + 0.25 * IN;
    const fitsCope = id.d * IN - copeDepth > (id.tf + 0.6) * IN;
    xs.forEach((x, k) => {
      const edge = k === 0 || k === N + 1;
      const grp = new THREE.Group();
      grp.position.set(x, 0, 0);
      grp.userData = { kind: edge ? 'edge infill' : 'infill' };
      const mat = edge ? this.mat.edge : this.mat.infill;
      const z0 = edge ? colHalfZ : webFace, z1 = edge ? Lj - colHalfZ : Lj - webFace;
      if (edge || !fitsCope) {
        const mesh = new THREE.Mesh(extrude(iShape(id), z1 - z0, Math.ceil(Lj * 1.5)), mat);
        mesh.position.z = z0;
        grp.add(mesh);
      } else {
        const body = new THREE.Mesh(extrude(iShape(id), z1 - z0 - 2 * copeLen, Math.ceil(Lj * 1.5)), mat);
        body.position.z = z0 + copeLen;
        const e0 = new THREE.Mesh(extrude(iShape(id, copeDepth), copeLen, 1), mat);
        e0.position.z = z0;
        const e1 = new THREE.Mesh(extrude(iShape(id, copeDepth), copeLen, 1), mat);
        e1.position.z = z1 - copeLen;
        grp.add(body, e0, e1);
      }
      grp.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData = { kind: grp.userData.kind }; this.pickables.push(o); } });
      this.members.add(grp);
    });

    // ---- deck ----
    const hr = m.hr;
    const prof = deckProfile(hr, Lj * 12);
    const nx = Math.max(24, Math.ceil(Lg * 1.2));
    const pos = [], idx = [];
    for (let ix = 0; ix <= nx; ix++) {
      const x = Lg * ix / nx;
      for (const [zi, yi] of prof) pos.push(x, yi * IN + 0.002, zi * IN);
    }
    const np = prof.length;
    for (let ix = 0; ix < nx; ix++) for (let j = 0; j < np - 1; j++) {
      const a = ix * np + j, b = a + 1, c = a + np, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dg.setIndex(idx);
    dg.computeVertexNormals();
    this.deck = new THREE.Mesh(dg, this.mat.deck);
    this.deck.castShadow = true;
    this.deck.receiveShadow = true;
    this.deck.visible = this.layers.deck;
    this.deck.userData = { kind: 'deck' };
    G.add(this.deck);

    // ---- concrete ----
    const top = (hr + m.tc + (m.add || 0)) * IN;
    this.slabTop = top;
    this.slab = new THREE.Group();
    const section = new THREE.Shape();
    // the top edge needs vertices along it to follow the floor's sag (displacement is per vertex)
    const nTop = Math.max(16, Math.ceil(Lj * 2));
    section.moveTo(0, top);
    for (let k = 1; k <= nTop; k++) section.lineTo(Lj * k / nTop, top);
    for (let j = prof.length - 1; j >= 0; j--) section.lineTo(prof[j][0] * IN, prof[j][1] * IN);
    section.closePath();
    const endGeo = new THREE.ShapeGeometry(section, 1);
    endGeo.userData = {};
    for (const x of [0, Lg]) {
      const f = new THREE.Mesh(endGeo, this.mat.conc);
      f.rotation.y = -PI / 2;
      f.position.x = x;
      f.userData.keepGeo = x !== 0;
      this.slab.add(f);
    }
    this.capGeo = endGeo;
    this.cap = new THREE.Mesh(endGeo, this.mat.capConc);
    this.cap.rotation.y = -PI / 2;
    this.cap.userData.keepGeo = true;
    this.cap.visible = false;
    this.slab.add(this.cap);
    for (const z of [0, Lj]) {
      const pg = new THREE.PlaneGeometry(Lg, top, Math.ceil(Lg), 1);
      pg.translate(Lg / 2, top / 2, 0);
      const f = new THREE.Mesh(pg, this.mat.conc);
      f.position.z = z;
      this.slab.add(f);
    }
    const fg = new THREE.PlaneGeometry(Lg, Lj, Math.ceil(Lg * 3), Math.ceil(Lj * 3));
    fg.rotateX(-PI / 2);
    fg.translate(Lg / 2, top, Lj / 2);
    this.floor = new THREE.Mesh(fg, this.mat.floor);
    this.floor.userData = { kind: 'floor' };
    this.floor.renderOrder = 2;
    this.slab.add(this.floor);
    this.slab.visible = this.layers.slab;
    G.add(this.slab);

    // ---- studs ----
    this.studs = new THREE.Group();
    if (m.composite) this._studs(m, xs, webFace, copeLen, colHalfX, colHalfZ, gLen);
    this.studs.visible = this.layers.studs;
    G.add(this.studs);

    // ---- context floor plate + DG 11 effective panels ----
    this.panels = new THREE.Group();
    this._panels(m, top);
    this.panels.visible = this.layers.panels;
    G.add(this.panels);

    // ---- dimensions ----
    this.dims = new THREE.Group();
    this._dims(m, top, gd);
    this.dims.visible = this.layers.dims;
    G.add(this.dims);

    // ---- labels ----
    const mid = xs[Math.max(1, Math.floor(xs.length / 2))];
    const studTxt = (mm, girder) => m.composite && mm.studs ? ` <small>[${mm.studs} studs${mm.perRib > 1 ? (girder ? `, ${mm.perRib} abreast` : `, ${mm.perRib}/rib`) : ''}]</small>` : '';
    const camTxt = (mm) => mm.camber ? ` <small>c = ${mm.camber}"</small>` : '';
    this._label(new THREE.Vector3(Lg * 0.62, top + 0.2, 0), `<span style="color:#FCAE2E">●</span> Girder ${m.girder.name}${studTxt(m.girder, true)}${camTxt(m.girder)}`, 'girder');
    this._label(new THREE.Vector3(mid, top + 0.2, Lj * 0.5), `<span style="color:#85C1E9">●</span> Infill ${m.infill.name}${studTxt(m.infill)}${camTxt(m.infill)}`, 'infill');
    this._label(new THREE.Vector3(Lg * 0.18, top + 0.2, Lj * 0.85), `${m.deckLabel || hr + '" deck'} <small>· ${fmt2(hr + m.tc + (m.add || 0))}" slab total</small>`, 'deck');

    // shadows follow the vibration: displaced shadow-casters render their shadow with the displaced depth material
    this.root.traverse(o => { if (o.isMesh && o.castShadow && o.material?.userData?.disp) o.customDepthMaterial = this.mat.depthDisp; });

    this._applyLayers();
    this.setSection(this.cut);
  }

  _studs(m, xs, webFace, copeLen, colHalfX, colHalfZ, gLen) {
    const hr = m.hr;
    const H = (hr + 1.5) * IN, head = 0.375 * IN, rS = 0.375 * IN, rH = 0.625 * IN;
    const shankG = new THREE.CylinderGeometry(rS, rS, H - head, 10);
    shankG.translate(0, (H - head) / 2, 0);
    const headG = new THREE.CylinderGeometry(rH, rH, head, 14);
    headG.translate(0, H - head / 2, 0);
    const mats = [];
    const pitch = DECK[hr].pitch * IN;
    const place = (n, perRib, positions, across, along) => {
      // positions: candidate rib positions (ft) along the member; choose evenly spread ribs
      const ribs = Math.ceil(n / Math.max(1, perRib));
      const out = [];
      if (!positions.length || !n) return out;
      const use = Math.min(ribs, positions.length);
      for (let k = 0; k < use; k++) {
        const t = use === 1 ? 0.5 : k / (use - 1);
        const p = positions[Math.round(t * (positions.length - 1))];
        const here = Math.min(perRib, n - out.length);
        for (let q = 0; q < here; q++) {
          const off = (q - (here - 1) / 2) * Math.min(3 * IN, across);
          out.push(along(p, off));
        }
      }
      return out;
    };
    // infills: studs sit in the flutes (centres at z = k * pitch)
    xs.forEach((x, k) => {
      const edge = k === 0 || k === xs.length - 1;
      const z0 = (edge ? colHalfZ : webFace + copeLen) + 3 * IN, z1 = m.Lj - z0;
      const ribs = [];
      for (let z = 0; z <= m.Lj + 1e-6; z += pitch) if (z >= z0 && z <= z1) ribs.push(z);
      const across = Math.max(1.5 * IN, (m.infill.dims.bf / 2 - 0.6) * IN * 2 / Math.max(1, m.infill.perRib - 1));
      place(m.infill.studs, m.infill.perRib, ribs, across, (z, off) => [x + off, z]).forEach(p => mats.push(p));
    });
    // girders: deck ribs run parallel, studs evenly spaced along the length
    for (const z of [0, m.Lj]) {
      const pos = [];
      const n = Math.ceil(m.girder.studs / Math.max(1, m.girder.perRib));
      for (let k = 0; k < n; k++) pos.push(colHalfX + 6 * IN + (gLen - 12 * IN) * (n === 1 ? 0.5 : k / (n - 1)));
      const across = Math.max(1.5 * IN, (m.girder.dims.bf / 2 - 0.6) * IN * 2 / Math.max(1, m.girder.perRib - 1));
      place(m.girder.studs, m.girder.perRib, pos, across, (x, off) => [x, z + off]).forEach(p => mats.push(p));
    }
    const count = mats.length;
    if (!count) return;
    const shank = new THREE.InstancedMesh(shankG, this.mat.stud, count);
    const headM = new THREE.InstancedMesh(headG, this.mat.stud, count);
    const M = new THREE.Matrix4();
    mats.forEach(([x, z], i) => { M.makeTranslation(x, 0.002, z); shank.setMatrixAt(i, M); headM.setMatrixAt(i, M); });
    shank.castShadow = headM.castShadow = true;
    shank.userData = headM.userData = { kind: 'stud' };
    this.studs.add(shank, headM);
    this.studCount = count;
  }

  _panels(m, top) {
    const vib = m.vib || {};
    const Lg = m.Lg, Lj = m.Lj;
    // neighbouring bays as a translucent plate with column lines (context)
    const ext = 1;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(Lg * (2 * ext + 1), Lj * (2 * ext + 1)),
      new THREE.MeshBasicMaterial({ color: 0x85c1e9, transparent: true, opacity: 0.04, depthWrite: false, side: THREE.DoubleSide }));
    plate.rotation.x = -PI / 2;
    plate.position.set(Lg / 2, top - 0.01, Lj / 2);
    this.panels.add(plate);
    const lines = [];
    for (let k = -ext; k <= ext + 1; k++) {
      lines.push(new THREE.Vector3(k * Lg, top, -ext * Lj), new THREE.Vector3(k * Lg, top, (ext + 1) * Lj));
      lines.push(new THREE.Vector3(-ext * Lg, top, k * Lj), new THREE.Vector3((ext + 1) * Lg, top, k * Lj));
    }
    const lg = new THREE.BufferGeometry().setFromPoints(lines);
    this.panels.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x85c1e9, transparent: true, opacity: 0.25 })));
    const rect = (w, l, color, cx, cz) => {
      const g = new THREE.Group();
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, depthWrite: false, side: THREE.DoubleSide }));
      fill.rotation.x = -PI / 2;
      fill.position.set(cx, top + 0.03, cz);
      const pts = [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2], [-w / 2, -l / 2]].map(([a, b]) => new THREE.Vector3(cx + a, top + 0.05, cz + b));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8 }));
      line.computeLineDistances();
      g.add(fill, line);
      return g;
    };
    if (Number.isFinite(vib.Bj)) {
      // beam panel: width Bj across the infills (x), length Lj
      this.panels.add(rect(vib.Bj, Lj, 0x85c1e9, Lg / 2, Lj / 2));
      this._label(new THREE.Vector3(Lg / 2 + vib.Bj / 2, top + 0.1, Lj * 0.08), `B<sub>j</sub> = ${fmt2(vib.Bj)} ft <small>beam panel width</small>`, 'panel', this.panels);
    }
    if (Number.isFinite(vib.Bg)) {
      // girder panel: width Bg across the girders (z), length Lg
      this.panels.add(rect(Lg, vib.Bg, 0xa3b376, Lg / 2, Lj / 2));
      this._label(new THREE.Vector3(Lg * 0.92, top + 0.1, Lj / 2 + vib.Bg / 2), `B<sub>g</sub> = ${fmt2(vib.Bg)} ft <small>girder panel width</small>`, 'panel', this.panels);
    }
  }

  // Plan dimensions drawn like a drawing: in the plane of the slab top, outside the bay on the two sides the default
  // 3D view faces (+x and +z), with extension lines and 45° ticks. Flat strips rather than GL lines (which are one
  // device pixel wide, invisible on high-DPI screens), drawn on top so the steel never hides them.
  _dims(m, top, gd) {
    const R = Math.max(m.Lg, m.Lj);
    const y = top + 0.02;
    const w = Math.max(0.06, R * 0.004);              // strip width, ft
    const off1 = Math.max(2.0, R * 0.075), off2 = off1 * 1.9, ext = Math.max(0.6, R * 0.02), gap = Math.max(0.35, R * 0.01);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcfe3f3, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const bar = (ax, az, bx, bz, width = w) => {
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
      const px = -dz / L * width / 2, pz = dx / L * width / 2;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        ax + px, y, az + pz, bx + px, y, bz + pz, bx - px, y, bz - pz,
        ax + px, y, az + pz, bx - px, y, bz - pz, ax - px, y, az - pz], 3));
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 20;
      this.dims.add(mesh);
    };
    const t = off1 * 0.16;                               // half-length of a 45° tick
    const tick = (x, z) => bar(x - t, z - t, x + t, z + t, w * 1.6);
    // a dimension along x at depth z (extension lines from zFrom), or along z at x (extension lines from xFrom)
    const dimX = (x0, x1, z, zFrom, html) => {
      bar(x0, z, x1, z);
      for (const x of [x0, x1]) { bar(x, zFrom + gap, x, z + ext, w * 0.7); tick(x, z); }
      this._label(new THREE.Vector3((x0 + x1) / 2, y, z), html, 'dim', this.dims);
    };
    const dimZ = (z0, z1, x, xFrom, html) => {
      bar(x, z0, x, z1);
      for (const z of [z0, z1]) { bar(xFrom + gap, z, x + ext, z, w * 0.7); tick(x, z); }
      this._label(new THREE.Vector3(x, y, (z0 + z1) / 2), html, 'dim', this.dims);
    };
    // infill spacing s: the last bay of infills, on the inner row along the +z girder
    if (m.N >= 1) dimX(m.Lg - m.s, m.Lg, m.Lj + off1, m.Lj, `s = ${fmt2(m.s)} ft`);
    // girder span Lg: overall, outer row
    dimX(0, m.Lg, m.Lj + (m.N >= 1 ? off2 : off1), m.Lj, `L<sub>g</sub> = ${m.Lg} ft`);
    // infill span Lj, along the +x side
    dimZ(0, m.Lj, m.Lg + off1, m.Lg, `L<sub>j</sub> = ${m.Lj} ft`);
  }

  _label(pos, html, kind, parent) {
    const el = document.createElement('div');
    el.className = 'lbl ' + (kind === 'dim' ? 'dim' : kind);
    el.innerHTML = html;
    this.labelLayer.append(el);
    this.labels.push({ el, pos, kind, parent });
  }

  // -------------------------------------------------------------------------
  setLayer(name, on) {
    this.layers[name] = on;
    this._applyLayers();
  }
  _applyLayers() {
    const L = this.layers;
    if (!this.model) return;
    if (this.slab) this.slab.visible = L.slab;
    if (this.deck) this.deck.visible = L.deck;
    if (this.studs) this.studs.visible = L.studs;
    if (this.panels) this.panels.visible = L.panels;
    if (this.columns) this.columns.visible = L.columns;
    if (this.dims) this.dims.visible = L.dims;
    const x = L.xray;
    this.mat.conc.transparent = x; this.mat.conc.opacity = x ? 0.15 : 1; this.mat.conc.depthWrite = !x;
    this.mat.deck.transparent = x; this.mat.deck.opacity = x ? 0.35 : 1; this.mat.deck.depthWrite = !x;
    this.floorU.uXray.value = x ? 1 : 0;
    this.mat.floor.depthWrite = !x;
    this.mat.stud.emissive = new THREE.Color(x ? 0x806020 : 0x000000);
    this.mat.conc.needsUpdate = this.mat.deck.needsUpdate = true;
  }

  setFloorMode(mode) { this.floorMode = mode; this._applyFloorMode(); }
  _applyFloorMode() {
    this.floorU.uMode.value = { concrete: 0, mode: 1, accel: 2, defl: 3 }[this.floorMode] ?? 1;
  }
  setMotion(m) {
    this.motion = m;
    if (m === 'walk') this._startWalk(); else this._stopWalk();
  }
  setExaggeration(k) { this.exag = k; }
  setSlow(s) { this.slow = s; }
  setStepHz(f) { this.stepHz = f; }

  setSection(t) {
    this.cut = t;
    if (!this.model) return;
    const xCut = t <= 0.001 ? -1 : t * this.model.Lg;
    // clipping planes are in world space: keep x >= xCut (bay coords)
    const worldX = xCut - this.model.Lg / 2;
    this.clipPlane.set(new THREE.Vector3(1, 0, 0), -worldX);
    if (xCut < 0) this.clipPlane.constant = 1e6;
    this.floorU.uCut.value = xCut;
    if (this.cap) {
      this.cap.visible = xCut > 0 && this.layers.slab;
      this.cap.position.x = xCut;
    }
    if (this.girderCaps) {
      this.girderCaps.visible = xCut > 0;
      this.girderCaps.children.forEach(c => { c.position.x = xCut; });
    }
  }

  setView(name, animate = true) {
    this.view = name;
    if (!this.model) return;
    if (name !== 'section' && this.cut > 0) { this.setSection(0); this.opts.onSection?.(0); }
    const { Lg, Lj } = this.model;
    const R = Math.max(Lg, Lj);
    const t = new THREE.Vector3(0, -0.6, 0);
    // distance that fits the bay (plus the toolbar/HUD overlays) in this viewport, any aspect ratio
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dimsPad = this.layers.dims ? Math.max(2, R * 0.07) : 0;   // the plan dimensions sit outside the bay
    const fit = (0.5 * Math.hypot(Lg, Lj) + 1.5 + dimsPad) * 1.18 / Math.sin(Math.min(vfov, hfov) / 2);
    const along = (x, y, z) => new THREE.Vector3(x, y, z).normalize().multiplyScalar(fit);
    let p;
    if (name === 'top') p = new THREE.Vector3(0.001, fit, 0.01);
    else if (name === 'section') {
      const xc = (this.cut > 0 ? this.cut * Lg : Lg * 0.5) - Lg / 2;
      if (this.cut <= 0) this.setSection(0.5);
      this.opts.onSection?.(this.cut);
      // look along +x at the cut, framed on the front girder and a few deck flutes
      // level elevation looking along +x at the cut face, front girder at the left edge
      const zf = -Lj / 2 + Math.min(3.2, Lj * 0.2);
      const gdep = (this.model.girder.dims?.d || 18) * IN;
      p = new THREE.Vector3(xc - 7.5, -gdep * 0.3, zf);
      t.set(xc, -gdep * 0.3, zf);
    } else if (name === 'under') p = along(0.55, -0.45, 0.75);
    else if (name === 'close') {
      // first interior infill framing into the front girder, seen from below and outside
      const xs = -Lg / 2 + (this.model.s || Lg / 2);
      p = new THREE.Vector3(xs + 5.5, -3.2, -Lj / 2 - 5.0);
      t.set(xs, -0.9, -Lj / 2 + 1.2);
    }
    else p = along(0.8, 0.62, 0.95);
    this._tween(p, t, animate ? 900 : 0);
  }

  _tween(pos, target, ms) {
    const c = this.camera, ctl = this.controls;
    if (!ms) { c.position.copy(pos); ctl.target.copy(target); ctl.update(); return; }
    const p0 = c.position.clone(), t0 = ctl.target.clone();
    const start = performance.now();
    this._tw = (now) => {
      let k = Math.min(1, (now - start) / ms);
      k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      c.position.lerpVectors(p0, pos, k);
      ctl.target.lerpVectors(t0, target, k);
      if (k >= 1) this._tw = null;
    };
  }

  // -------------------------------------------------------------------------
  stomp(x, z, strength = 1) {
    const r = this.U.uRip.value[this.ripIdx++ % 8];
    r.set(x, z, 0, strength);
  }

  _rayFloor(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objs = [];
    if (this.floor && this.slab?.visible) objs.push(this.floor);
    objs.push(...(this.pickables || []));
    const hit = this.raycaster.intersectObjects(objs, false)[0];
    if (!hit) return null;
    const p = hit.point.clone();
    const bx = p.x + this.model.Lg / 2, bz = p.z + this.model.Lj / 2;
    return { hit, bx, bz, kind: hit.object.userData.kind || (hit.object.parent?.userData?.kind) };
  }

  phiAt(bx, bz) {
    const { Lg, Lj } = this.model;
    if (bx < 0 || bz < 0 || bx > Lg || bz > Lj) return 0;
    const dj = this.U.uDj.value, dg = this.U.uDg.value;
    return (dg * Math.sin(PI * bx / Lg) + dj * Math.sin(PI * bz / Lj)) / Math.max(dg + dj, 1e-9);
  }

  _click(e) {
    if (!this.model) return;
    const r = this._rayFloor(e);
    if (!r) return;
    if (r.kind === 'floor') {
      this.stomp(r.bx, r.bz, 1);
      this.opts.onProbe?.({ x: r.bx, z: r.bz, phi: this.phiAt(r.bx, r.bz) });
    } else {
      this.opts.onPick?.(r.kind);
    }
  }

  _hover(e) {
    if (!this.model || this.motion === 'walk') return;
    const now = performance.now();
    if (this._lastHover && now - this._lastHover < 40) return;
    this._lastHover = now;
    const r = this._rayFloor(e);
    if (r && r.kind === 'floor') {
      this.floorU.uHover.value.set(r.bx, r.bz, 1);
      this.opts.onHover?.({ x: r.bx, z: r.bz, phi: this.phiAt(r.bx, r.bz) });
    } else {
      this.floorU.uHover.value.z = -1;
      this.opts.onHover?.(null);
    }
  }

  _startWalk() {
    if (!this.model || this.walker) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 2.6, 6, 12), new THREE.MeshStandardMaterial({ color: 0xfcae2e, roughness: 0.5, emissive: 0x3a2400 }));
    body.position.y = 1.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfcae2e, roughness: 0.4, emissive: 0x3a2400 }));
    head.position.y = 3.65;
    body.castShadow = head.castShadow = true;
    g.add(body, head);
    this.walker = g;
    this.root.add(g);
    this.walkState = { s: 0, lastStep: 0, side: 1, resp: 0, prints: [] };
    if (this.floorMode === 'concrete') this.setFloorMode('accel');   // the walk is shown on the Peak accel. overlay
  }
  _stopWalk() {
    if (this.walker) { this.root.remove(this.walker); this.walker = null; }
    if (this.model) this.floorU.uAp.value = this.model.vib?.ap || 0;   // back to the solver's a_p
    this.liveAccel = 0;
    (this.walkState.prints || []).forEach(p => { this.root.remove(p.mesh); p.mesh.geometry.dispose(); });
    this.walkState.prints = [];
  }

  // -------------------------------------------------------------------------
  _frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();
    if (this._tw) this._tw(now);
    this.controls.update();
    this.tVis += dt * this.slow;
    const U = this.U;
    U.uTime.value += dt;
    for (const r of U.uRip.value) r.z += dt;

    const m = this.model;
    if (m) {
      const vib = m.vib || {};
      const dtot = ((vib.dj || 0) + (vib.dg || 0)) * IN;
      let phase = 0;
      if (this.motion === 'vibrate') phase = Math.cos(2 * PI * (vib.fn || 4) * this.tVis);
      else if (this.motion === 'walk') phase = this._walkFrame(dt) * Math.cos(2 * PI * (vib.fn || 4) * this.tVis);
      else if (this.floorMode === 'defl') phase = 1;
      U.uPhase.value = phase;
      U.uAmp.value = dtot * this.exag;
      if (this._growT !== undefined && this._growT < 1) {
        this._growT = Math.min(1, this._growT + dt * 2.2);
        const k = 1 - Math.pow(1 - this._growT, 3);
        this.members.scale.y = 0.02 + 0.98 * k;
        this.slab.position.y = (1 - k) * 2.5;
        this.mat.floor.opacity = k;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this._placeLabels();
  }

  _walkFrame(dt) {
    const m = this.model, W = this.walkState;
    const vib = m.vib || {};
    // walk along the bay centreline, parallel to the girders, back and forth
    const speed = 2.4 * this.slow * 4;          // ft per visual second (slow-motion scaled)
    W.s += dt * speed;
    const L = m.Lg + 8;
    const u = (W.s % (2 * L)) / L;
    const dir = u < 1 ? 1 : -1;
    const x = (u < 1 ? u : 2 - u) * L - 4;
    const z = m.Lj / 2;
    this.walker.position.set(x, this.slabTop, z);
    this.walker.rotation.y = dir > 0 ? 0 : PI;
    const stepT = 1 / (this.stepHz * this.slow * 4);
    W.lastStep += dt;
    if (W.lastStep > stepT) {
      W.lastStep = 0;
      W.side *= -1;
      const fz = z + W.side * 0.45;
      if (x > 0 && x < m.Lg) {
        this.stomp(x, fz, 0.6);
        const fp = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
        fp.rotation.x = -PI / 2;
        fp.scale.set(1, 1.7, 1);
        fp.position.set(x, this.slabTop + 0.03, fz);
        this.root.add(fp);
        W.prints.push({ mesh: fp, age: 0 });
      }
    }
    for (const p of W.prints) { p.age += dt; p.mesh.material.opacity = Math.max(0, 0.85 - p.age * 0.35); }
    while (W.prints.length && W.prints[0].age > 2.6) { const p = W.prints.shift(); this.root.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    // response at mid-bay builds toward DG 11's a_p scaled by the walker's modal position
    const target = this.phiAt(x, z);
    W.resp += (target - W.resp) * Math.min(1, dt * 1.8);
    this.liveAccel = (vib.ap || 0) * W.resp;
    // the Peak accel. overlay follows the walker: a_p x phi(walker) x phi(x, z). With the walker at mid-bay and the
    // response built up it is exactly the static DG 11 picture (the solver's a_p); it never exceeds it.
    this.floorU.uAp.value = this.liveAccel;
    this.opts.onWalk?.({ x, z, resp: W.resp, accel: this.liveAccel });
    return W.resp;
  }

  _placeLabels() {
    if (!this.labels.length) return;
    const show = this.layers.labels;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      const visible = show && (!l.parent || l.parent.visible);
      if (!visible) { l.el.style.display = 'none'; continue; }
      v.copy(l.pos).add(this.root.position).project(this.camera);
      if (v.z > 1 || v.z < -1) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      l.el.style.left = `${(v.x + 1) / 2 * w}px`;
      l.el.style.top = `${(1 - v.y) / 2 * h}px`;
    }
  }

  // Screenshots for the report: each { view, floor, layers, title } rendered at a fixed size with its labels drawn in,
  // then the camera, overlay, layers, size and motion are put back exactly as they were.
  captureViews(list, { width = 1400, height = 860 } = {}) {
    if (!this.renderer || !this.model) return [];
    const r = this.renderer, cam = this.camera, ctl = this.controls;
    const saved = {
      pos: cam.position.clone(), tgt: ctl.target.clone(), view: this.view, floor: this.floorMode, cut: this.cut,
      layers: { ...this.layers }, motion: this.motion, ratio: r.getPixelRatio(), tw: this._tw,
    };
    this._tw = null;
    if (this.motion !== 'still') this.setMotion('still');
    if (this._growT !== undefined && this._growT < 1) {        // finish the build-in animation
      this._growT = 1; this.members.scale.y = 1; this.slab.position.y = 0; this.mat.floor.opacity = 1;
    }
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    const out = [];
    try {
      for (const s of list) {
        Object.assign(this.layers, saved.layers, s.layers || {});
        this._applyLayers();
        this.setFloorMode(s.floor || saved.floor);
        this.floorU.uPhase.value = this.floorMode === 'defl' ? 1 : 0;
        this.setView(s.view, false);
        if (s.zoom) cam.position.sub(ctl.target).multiplyScalar(s.zoom).add(ctl.target);   // tighter framing for a still
        ctl.update();
        r.render(this.scene, cam);
        out.push({ ...s, src: this._compositeLabels(width, height) });
      }
    } finally {
      r.setPixelRatio(saved.ratio);
      Object.assign(this.layers, saved.layers);
      this._applyLayers();
      this.setFloorMode(saved.floor);
      this.view = saved.view;
      this.setSection(saved.cut || 0);
      this.opts.onSection?.(saved.cut || 0);
      this._resize();
      cam.position.copy(saved.pos); ctl.target.copy(saved.tgt); ctl.update();
      this._tw = saved.tw;
      if (saved.motion !== 'still') this.setMotion(saved.motion);
    }
    return out;
  }

  // the WebGL frame plus the HTML labels (dimensions, member tags), drawn as the app draws them
  _compositeLabels(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(this.renderer.domElement, 0, 0, w, h);
    if (this.layers.labels) {
      const v = new THREE.Vector3();
      g.font = '600 15px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      g.textBaseline = 'middle';
      for (const l of this.labels) {
        if (l.parent && !l.parent.visible) continue;
        v.copy(l.pos).add(this.root.position).project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
        if (x < -50 || x > w + 50 || y < -20 || y > h + 20) continue;
        const text = l.el.textContent.replace(/\s+/g, ' ').trim();
        const tw = g.measureText(text).width, bw = tw + 16, bh = 26;
        const bx = x - bw / 2, by = l.kind === 'dim' ? y - bh / 2 : y - bh;      // .lbl.dim is centred, others sit above
        g.fillStyle = l.kind === 'dim' ? 'rgba(10,14,19,.72)' : 'rgba(10,14,19,.85)';
        g.strokeStyle = { girder: 'rgba(252,174,46,.8)', infill: 'rgba(133,193,233,.8)', panel: 'rgba(163,179,118,.85)' }[l.kind] || 'rgba(255,255,255,.18)';
        g.lineWidth = 1.5;
        g.beginPath(); g.roundRect(bx, by, bw, bh, 6); g.fill(); g.stroke();
        g.fillStyle = l.kind === 'dim' ? '#cfe3f3' : '#e7edf3';
        g.fillText(text, bx + 8, by + bh / 2 + 1);
      }
    }
    return c.toDataURL('image/jpeg', 0.9);
  }

  snapshot() {
    if (!this.renderer) return null;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function fmt2(v) { return Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '—'; }
