# engine/paper

Byte-identical copies of the files the paper's code release ships (MS-Vibration-Code, commit `23c2637`,
"Paper release: final notebooks, SI and imperial datasets, licence"):

| file | role |
|---|---|
| `Composite MS Code.ipynb` | composite solver; code cells 0-1 define `sizer_and_calc` |
| `Non-Composite MS Code.ipynb` | non-composite solver |
| `AISC STEEL MANUAL V16 (Modified) Sorted.csv` | W-shape table the solvers read |
| `DeckData.csv` | deck/slab table the solvers read |

`SHA256SUMS` holds their checksums; `tests/test_engine.py` fails if any file differs. **Do not edit these files.** To
update the solver, replace them with a new release and update `SHA256SUMS`.
