# ParaFloor

Interactive companion to **_Carbon-Efficient Design Strategies for Mitigating Footfall Vibration in Steel Framed Floor Systems_**
(S. D. Farrow, N. C. Brown and R. L. Solnosky; *Engineering Structures*, under review).

It runs **the paper's own solver**, the code published in
[MS-Vibration-Code](https://github.com/farrowsky/MS-Vibration-Code), and shows everything it computes:

* **Bay Designer.** Enter a bay, and the solver either *optimizes* it (the lowest-carbon members that pass strength, deflection
  and AISC Design Guide 11 walking vibration, then every mitigation path) or *checks* the infill and girder you pick. The
  bay is drawn in 3D with true AISC member sizes, the selected deck and topping, and the shear studs. The floor is coloured by
  the DG 11 mode shape and peak acceleration in the paper's colormap, and can vibrate, ripple under a click, or carry a
  walker. Every intermediate value is one click away, next to the notebook line that computed it, and exports to a
  printable **calculation report**.
* **Design Space.** All 40,344 published designs as heatmaps, a 3D landscape and scatter plots, plus the paper's
  Figures 1–15 with zoom and links to the matching interactive views.

> **Research showcase, not a design tool.** See [DISCLAIMER.md](DISCLAIMER.md). Nothing this tool produces may be used to
> design, check or approve a structure.

---

## Quick start

Requires **Python 3.12 or newer** (the calculation capture uses `sys.monitoring`, added in 3.12). Developed on Python 3.13.

**Windows:** double-click **`ParaFloor.bat`**. It finds Python 3.12+ (including Anaconda), installs the four
dependencies on first run if they are missing, starts the solver service in the background and opens the tool in its own
app window. Closing the window stops the service.
**macOS / Linux:** `./run.sh` (opens <http://localhost:8000> in the browser).

Opening `web/index.html` directly from disk does not work (browsers block the app's modules on `file://`); the page then
points you to the launcher.

By hand:

```bash
python -m pip install -r requirements.txt
python -m uvicorn server.app:app --port 8000
```

**Docker:**

```bash
docker build -t parafloor .
docker run -p 8000:8000 parafloor
```

---

## How the numbers get to the screen

```
engine/paper/*.ipynb ──exec cells, unmodified──▶ sizer_and_calc()           (server/engine.py)
                                                    │
                       sys.monitoring (read-only) ──┤  mitigation_method() locals at the selected pair
                                                    ▼
                                 four validations ──▶ JSON ──▶ 3D bay, calc inspector, report  (web/)
```

1. **The paper's code, verbatim.** `server/engine.py` reads `Composite MS Code.ipynb` and `Non-Composite MS Code.ipynb`
   (byte-identical copies of the release; checksums in `engine/paper/SHA256SUMS`). It executes the code cells up to the one
   defining `sizer_and_calc` and calls that function. No solver line is re-implemented. The only wrapper is a `pd.read_csv`
   proxy that finds the two tables in `engine/paper/` and memoises them, returning a fresh deep copy on every call.
2. **Every intermediate value.** Python's `sys.monitoring` reports each return of the solver's inner `mitigation_method()`.
   Its ~400 local variables (loads, moments, capacities, deflections, camber, studs, the DG 11 chain, the carbon take-off) are
   copied and reduced to the selected infill/girder pair. Variables indexed by infill are `(n, 1)`, by girder `(1, n)`, and
   by pair `(n, n)`.
3. **Four validations on every result** (the *Validation* tab and section 6 of the report):
   * **Outputs vs internals.** Each column the solver reports for a design state is compared with the internal variable it
     maps from. The mapping is read from the solver's own `target_base_matrices` and `results` dict with `ast`.
   * **Line-by-line re-execution.** Every elementwise assignment in `mitigation_method()` is evaluated again on the pair's
     captured inputs, and the result must equal the captured value. Elementwise numpy commutes with indexing, so this
     verifies the capture and replays the solver's arithmetic for that one design. About 230 composite and 125
     non-composite lines are re-run per design, with zero mismatches.
   * **Carbon identity.** The per-component take-off, using the factors read from the solver's `EC` line, sums to the
     solver's `EC`.
   * **Published dataset.** On the paper's grid, the live result is compared field by field with the published row.
4. **Visualised, not re-derived.** The browser only draws. Deflection limits written inline in the solver's checks
   (`min(L/360, 1 in)`, `L/240`) are shown next to the solver's own pass/fail booleans.

### Found by the validation

The validation found one reporting quirk in the published composite notebook. In cell 1, line 1809 (`concrete_upsizing`),
`"Infill Case Label"` is built with `expand_girder(...)` on an infill-indexed array, so the *Mitigated Conc* frame can
show the PNA case label of the wrong shape. It is descriptive only: the infill moment capacity on the same row uses
`expand_infill` and validates. The tool shows the captured (correct) label and flags the difference. It does not edit
the solver.

---

## Repository layout

```
engine/paper/      the release's two notebooks and two tables (unmodified) + SHA256SUMS
server/            engine.py (load, run, capture, validate), calcmap.py (calc sections), service.py (the API as plain
                   functions), app.py (FastAPI wrapper)
web/               static front end (no build step): index.html, css/, js/, js/engine/ (in-browser solver), vendor/three.js r170,
                   data/, assets/figures/
tools/             build_web_data.py (packs the published datasets and figures), build_pages.py (static site), verify_release.py
tests/             pytest suite: provenance, capture validation, published-dataset agreement, API
docs/              METHOD.md, MODEL.md (3D geometry), DEPLOY.md (hosting)
```

`web/data/*.bin` is the release's `data/imperial/*_results_imperial.csv` packed into typed arrays (floats as float32; no
values changed). It is about 3 MB gzipped for all 40,344 designs. Rebuild it with:

```bash
python tools/build_web_data.py --release ../MS-Vibration-Code --figures "../Paper Final/GitHub Final Folder/figures"
```

## Tests

```bash
python -m pytest -q                                          # in-repo checks (~1 min)
MSVE_RELEASE=../MS-Vibration-Code python -m pytest -q        # + agreement with the published CSVs
python tools/verify_release.py --release ../MS-Vibration-Code --n 200    # larger random sample
python tools/check_original.py --release ../MS-Vibration-Code         # 100 LHS + 100 boundary cases vs the original notebooks
python tools/check_hand_calcs.py                                     # the thesis hand calcs vs the report
```

## Hosting

**Free, no server (GitHub Pages).** `python tools/build_pages.py` builds a static site in which the paper's solver runs in
the visitor's browser with [Pyodide](https://pyodide.org) (Python compiled to WebAssembly), through the same
`server/engine.py` and `server/service.py`. The first design takes about 25 s while the browser loads Python and numpy;
later ones take a few seconds. The results are bit-identical to the server's, and the four validations run as usual.
`.github/workflows/pages.yml` publishes it on every push to `main`. See [docs/DEPLOY.md](docs/DEPLOY.md).

**Server.** One small Python service serves both the API and the static site. The solver peaks at about 0.4 GB per run, so the server
runs **one solve at a time** with a short queue (busy → HTTP 503, and the page retries), and keeps an LRU cache of finished
designs. A 1 GB instance is comfortable. The Design Space module is fully static and also works when the front end is
hosted separately (set `window.MSVE_API` and `MSVE_ALLOW_ORIGIN`). See [docs/DEPLOY.md](docs/DEPLOY.md).

## Citation and licence

If you use this tool, please cite the paper (see [CITATION.cff](CITATION.cff)). Released under the MIT License
([LICENSE](LICENSE)). three.js r170 is vendored under its MIT License (`web/vendor/LICENSE-three.txt`).
