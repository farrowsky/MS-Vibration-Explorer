# How the tool shows the solver's calculations

## Running the published code

`server/engine.py` opens each notebook in `engine/paper/`, takes the code cells up to and including the one that defines
`sizer_and_calc`, and `exec`s them into a private namespace. The solver reads its two tables by bare file name. The
namespace's `pd` is a thin proxy whose `read_csv` resolves those names inside `engine/paper/` and memoises the parse,
handing back a deep copy on every call. Everything else is pandas. No line of the solver is copied, edited or
re-implemented.

## Capturing every intermediate value

`sizer_and_calc` computes each limit state for **every** infill × girder pair of the 273 W-shapes at once. Arrays indexed
by the infill are shaped `(n, 1)`, by the girder `(1, n)` or `(1, n, ·)`, and by the pair `(n, n)`. The selection code
then picks a pair (`RowIdx`, `ColIdx`) for each design state.

After the solver has run, a second run is made with `sys.monitoring` (PEP 669) watching the return of the nested
`mitigation_method()` code object. When the call for the wanted topping returns, its frame's locals are copied and
reduced to the selected pair. Scalars are kept as they are; `(n,1)` arrays give `[r, 0]`, `(1,n)` give `[0, c]`, `(n,n)`
give `[r, c]`, and the trailing 1/2/3-studs-per-rib axis is kept as a list. Shape-table columns that are 1-D are reported
for both members. Permuted copies (`*_sorted`) and whole tables are not reduced. Monitoring observes and never writes.

## Validations

| check | what it proves |
|---|---|
| **Outputs vs internals** | For each state, every column the solver writes to its output frame equals the captured internal variable it maps from. The mapping (`target_base_matrices` → `results` dict → local name) is read from the solver's source with `ast`. Proves the capture picked the right pair and the right call. |
| **Line re-execution** | Every single-target assignment in `mitigation_method()` made of elementwise arithmetic is `eval`ed again with the pair's captured inputs. Elementwise numpy operations commute with indexing, so the result must equal the captured value. Lines that use table lookups or reductions across shapes, and branches not taken, are reported as not re-evaluable. Proves the capture is self-consistent and replays the solver's arithmetic for this one design. |
| **Carbon identity** | (infill + girder steel) × 1.22 + deck × 2.32 + studs × 1.27 + concrete × ECF, in kg, equals `EC`. The factors are read from the solver's own `EC` line. |
| **Published dataset** | On the paper's grid, members, studs, peak acceleration, frequency, EC and method code of every state match the published `data/imperial` row. |

Two values on screen are computed in the browser, and each is checked against the solver:

* the per-component carbon split (checked by the identity above);
* deflection limits that the solver writes inline in its check lines (`min(L·12/360, 1)`, `L·12/240`). Pass/fail is
  always the solver's own boolean.

## Known reporting quirk

`Composite MS Code.ipynb`, cell 1 line 1809, `concrete_upsizing`:
`"Infill Case Label": expand_girder(mitigated_results['Case Label II'])[row_index, col_index]`. The array is indexed by
infill, but `expand_girder` lays it along the girder axis, so the reported label belongs to the shape at the girder's
index. Only this descriptive label is affected. The tool shows the captured value, marks the column as a known quirk,
and leaves the published code unchanged.
