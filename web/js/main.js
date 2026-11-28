// App shell: routing, theme, units, disclaimer, About page.
import { $, $$, esc, toast, store } from './lib/dom.js';
import { api, IN_BROWSER } from './lib/api.js';
import { APP_NAME, APP_TAGLINE } from './lib/brand.js';
import { PYODIDE_VERSION } from './engine/version.js';
import { setUnits, getUnits } from './lib/units.js';
import { createDesigner } from './designer/designer.js';

const views = {};
let designer = null, explorer = null;

// ---------------------------------------------------------------- name (web/js/lib/brand.js)
$('.brand-text').innerHTML = `<b>${APP_NAME}</b>`;
$('.brand').setAttribute('aria-label', `${APP_NAME} home`);

// ---------------------------------------------------------------- theme + units
function applyTheme(t) { document.documentElement.dataset.theme = t; store.set('theme', t); }
applyTheme(store.get('theme', window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
function syncUnitBtns() { $$('[data-units]').forEach(b => b.classList.toggle('on', b.dataset.units === getUnits())); }
$$('[data-units]').forEach(b => b.onclick = () => { setUnits(b.dataset.units); syncUnitBtns(); });
syncUnitBtns();

// ---------------------------------------------------------------- disclaimer gate
function disclaimer() {
  if (store.get('disclaimer.v1', false)) return;
  const dlg = $('#disclaimerDlg');
  const chk = $('#discAgree'), ok = $('#discOk');
  chk.onchange = () => { ok.disabled = !chk.checked; };
  ok.onclick = () => store.set('disclaimer.v1', true);
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  try { dlg.showModal(); } catch { /* old browsers: the banner still shows */ }
}

// ---------------------------------------------------------------- router
async function route() {
  const hash = location.hash || '#/designer';
  const [path, qs] = hash.slice(2).split('?');
  const name = ['designer', 'explore', 'about'].includes(path) ? path : 'designer';
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.route === name));
  document.title = { designer: 'Bay Designer', explore: 'Design Space', about: 'About & Method' }[name] + ` · ${APP_NAME}`;
  if (name === 'designer') {
    if (!designer) designer = createDesigner($('#view-designer'), {});
    await designer.show(qs);
  } else if (name === 'explore') {
    if (!explorer) {
      const mod = await import('./explore/explore.js');
      explorer = mod.createExplorer($('#view-explore'), { openInDesigner });
    }
    explorer.show(qs);
  } else if (name === 'about') {
    renderAbout();
    const target = new URLSearchParams(qs || '').get('s');
    if (target) document.getElementById(target)?.scrollIntoView();
  }
}

function openInDesigner(p) {
  if (!designer) designer = createDesigner($('#view-designer'), {});
  const q = new URLSearchParams({ sys: p.system === 'composite' ? 'c' : 'nc', g: p.g, i: p.i, c: p.conc, d: p.deck, p: p.pcc || 50, u: 3, cs: 3, fl: 200, fw: 200, m: 'opt' });
  location.hash = `#/designer?${q}`;
}

$$('[data-scroll]').forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  location.hash = `#/about?s=${a.dataset.scroll}`;
}));

// ---------------------------------------------------------------- About & Method
let aboutDone = false;
async function renderAbout() {
  if (aboutDone) return;
  aboutDone = true;
  const el = $('#view-about');
  let meta = window.__msveMeta;
  const prov = (s) => meta?.systems?.[s]?.provenance;
  el.innerHTML = `<div class="about">
    <h1>About &amp; method</h1>
    <p class="lead"><b>${APP_NAME}</b> (${APP_TAGLINE.toLowerCase()}) is the interactive companion to <i>Carbon-Efficient Design Strategies for Mitigating Footfall
      Vibration in Steel Framed Floor Systems</i> (S. D. Farrow, N. C. Brown and R. L. Solnosky). It runs the paper's own solver, the code
      published in the <b>MS-Vibration-Code</b> repository, so a reader can see exactly how each design in the study was produced, check
      every intermediate value, and explore the 40,344 published designs.</p>

    <div class="disclaimer-box" id="disclaimer" style="margin-top:20px">
      <h2>Disclaimer</h2>
      <p><b>This is a research showcase, not a design tool.</b> It exists to communicate and reproduce the published study. Nothing it
        produces is a structural design, a code check, a specification or professional engineering advice.</p>
      <ul>
        <li><b>Do not use the results to design, check, approve or modify any real structure.</b> Floor design requires a licensed
          professional engineer applying the governing building code, current standards and the project's actual conditions.</li>
        <li><b>The model is the study's model.</b> One interior bay with identical neighbours; uniform loads from the solver's occupancy
          table; deck and topping from a study table; members chosen from the AISC shapes the study allowed; the AISC Design Guide 11
          walking-excitation procedure for vibration; embodied-carbon factors from Table 3 of the paper. Connections, columns,
          diaphragm action, fire rating, constructability, ponding, rhythmic or sensitive-equipment criteria, and much more are not
          considered.</li>
        <li><b>Data sources.</b> Steel shape properties and deck values are the study's modified versions of the AISC <i>Steel
          Construction Manual</i> (16th ed.) and manufacturer/SDI tables. They may differ from the current official publications.</li>
        <li><b>Inputs outside the study</b> (spans outside 10–50 ft, other occupancies, other composite levels) run the same solver, but
          the paper made no claims about them and they have not been reviewed.</li>
        <li><b>No warranty and no liability.</b> The software and results are provided "as is", without warranty of any kind, under the
          MIT License. The authors, The Pennsylvania State University and any contributors are not liable for any claim, damage or
          other liability arising from the use of this tool or its output.</li>
        <li><b>Not endorsed.</b> References to AISC, SDI or any manufacturer describe data the study used; they do not imply
          endorsement of this tool.</li>
      </ul>
    </div>

    <h2>How the tool works</h2>
    <div class="steps">
      <div class="step"><b>1 · The paper's code, verbatim</b><p>The server reads the two published notebooks
        (<code>Composite MS Code.ipynb</code>, <code>Non-Composite MS Code.ipynb</code>) and executes their solver cells unmodified. Their
        SHA-256 hashes are shown on every result. A Custom design with your own beam count, slab, deck gauge, camber or studs runs
        a copy with one-line overrides for those values only, and every result that uses it says so.</p></div>
      <div class="step"><b>2 · Every intermediate value</b><p>Python's <code>sys.monitoring</code> observes the solver's inner
        <code>mitigation_method()</code> and copies its ~400 local variables at the selected infill/girder pair — read-only, so the
        solver computes exactly what it always does.</p></div>
      <div class="step"><b>3 · Four validations</b><p>Reported outputs vs captured internals; line-by-line re-execution of the solver's
        arithmetic at the pair; the carbon identity; and, on the paper's grid, a match against the published dataset.</p></div>
      <div class="step"><b>4 · Visualised, not re-derived</b><p>The 3D model uses true AISC member dimensions, the solver's stud counts,
        deck and topping; the floor colours are the solver's DG 11 mode shape and peak acceleration in the paper's colormap.</p></div>
    </div>

    <h2>Reading the 3D bay</h2>
    <ul>
      <li><b>Girders</b> (gold) span L<sub>g</sub> between columns; <b>infill beams</b> (blue) span L<sub>j</sub> between the girders at the
        spacing the solver chose from the deck table. Interior infills are coped at the top flange to sit flush with the girder.</li>
      <li><b>Deck</b> ribs run parallel to the girders. Pitch and top opening are the usual VL profile values; the bottom flat is set so
        the concrete in the flutes equals the solver's <code>Conc_Depth_in_Flute</code>, so the drawn concrete is the concrete the carbon
        take-off counts. Studs are ¾ in, rib depth + 1.5 in tall (the length implied by the solver's stud weights), placed in the
        flutes at the solver's count and studs-per-rib.</li>
      <li><b>Mode shape</b> φ(x, z) = (Δ<sub>g</sub> sin(πx/L<sub>g</sub>) + Δ<sub>j</sub> sin(πz/L<sub>j</sub>)) / (Δ<sub>j</sub> + Δ<sub>g</sub>),
        built from the solver's DG 11 beam and girder deflections; it equals 1 at mid-bay, where DG 11 evaluates the response.
        <b>Peak accel.</b> maps a<sub>p</sub>/g × φ with the tolerance contour — an illustration of where the floor moves most, since DG 11
        reports one value at mid-bay. <b>Walk test</b> and <b>stomp</b> ripples are visual effects; the numbers they show are DG 11's
        a<sub>p</sub> scaled by φ.</li>
      <li><b>B<sub>j</sub> / B<sub>g</sub></b> show the DG 11 effective panel widths the solver used for the panel weights W<sub>j</sub> and
        W<sub>g</sub>, against the neighbouring bays.</li>
    </ul>

    <h2>Provenance</h2>
    <table class="prov-table" id="provTable"><tr><td>Loading…</td><td></td></tr></table>

    <h2>Cite</h2>
    <p>S. D. Farrow, N. C. Brown, R. L. Solnosky. <i>Carbon-Efficient Design Strategies for Mitigating Footfall Vibration in Steel Framed
      Floor Systems.</i> Engineering Structures (under review), 2026. Code and data: MS-Vibration-Code. This tool: ${APP_NAME}.
      Both MIT License.</p>
    <p class="small muted">Department of Architectural Engineering, The Pennsylvania State University.</p>
  </div>`;
  try {
    meta = meta || await api.meta();
    const rows = [];
    for (const s of ['composite', 'noncomposite']) {
      const p = prov(s) || meta.systems[s].provenance;
      rows.push(`<tr><td>${s === 'composite' ? 'Composite' : 'Non-composite'} solver</td><td><code>${esc(p.notebook)}</code><br>notebook SHA-256 <code>${esc(p.notebook_sha256)}</code><br>solver cell SHA-256 <code>${esc(p.solver_cell_sha256)}</code></td></tr>`);
    }
    const p = meta.systems.composite.provenance;
    rows.push(IN_BROWSER
      ? `<tr><td>Runtime</td><td>Runs in your browser: Python compiled to WebAssembly (Pyodide ${esc(PYODIDE_VERSION)}). The Python, numpy and pandas versions are listed under each design. · tool ${esc(meta.version)}</td></tr>`
      : `<tr><td>Server runtime</td><td>Python ${esc(p.python)}, numpy ${esc(p.numpy)}, pandas ${esc(p.pandas)} · tool ${esc(meta.version)}</td></tr>`);
    rows.push(`<tr><td>Design-space data</td><td><code>data/imperial/composite_results_imperial.csv</code> (30,258 rows) and <code>noncomposite_results_imperial.csv</code> (10,086 rows) from the MS-Vibration-Code release, packed without changing values</td></tr>`);
    $('#provTable').innerHTML = rows.join('');
  } catch (e) {
    $('#provTable').innerHTML = `<tr><td>Server</td><td class="muted">Not reachable (${esc(e.message)}). The Design Space module still works offline.</td></tr>`;
  }
}

// ---------------------------------------------------------------- help popovers (click / keyboard, not hover-only)
let pop = null;
function closePop() { pop?.remove(); pop = null; }
document.addEventListener('click', (e) => {
  const b = e.target.closest('.help');
  if (!b) { if (!e.target.closest('.popover')) closePop(); return; }
  e.preventDefault(); e.stopPropagation();
  const same = pop && pop.dataset.for === b.dataset.help;
  closePop();
  if (same) return;
  pop = document.createElement('div');
  pop.className = 'popover';
  pop.setAttribute('role', 'tooltip');
  pop.dataset.for = b.dataset.help;
  pop.textContent = b.dataset.help.replace(/_([a-z])/g, (m, c) => c);
  document.body.append(pop);
  const r = b.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left - 10)) + 'px';
  pop.style.top = (r.bottom + 8 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + 'px';
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
window.addEventListener('scroll', closePop, true);

// ---------------------------------------------------------------- boot
(async function boot() {
  disclaimer();
  try {
    window.__msveMeta = await api.meta();
  } catch (e) {
    toast('The solver service is not reachable. The Design Space module still works; the Bay Designer needs the server.', 'err');
  }
  window.addEventListener('hashchange', route);
  route();
})();
