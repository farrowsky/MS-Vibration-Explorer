# The 3D bay

The 3D view draws one design state of one bay from the solver's captured values. Scene units are feet; bay coordinates
put `x` along the girders (0 … L<sub>g</sub>), `z` along the infills (0 … L<sub>j</sub>), `y` up, and the top of steel at
`y = 0`.

| element | source | how it is drawn |
|---|---|---|
| girders (gold) | `Girder Sizes`; d, b<sub>f</sub>, t<sub>f</sub>, t<sub>w</sub>, k<sub>des</sub> from `AISC STEEL MANUAL V16 (Modified) Sorted.csv` | two W-shapes on the column lines `z = 0`, `z = L_j`, true section with root fillets, ending ½ in short of the (context) columns |
| infills (blue) | `Infill Sizes`, `NumInfill`, `infill_spacing` | `NumInfill` interior beams at the solver's spacing plus the two edge beams on the column lines. Interior beams frame into the girder web and are coped at the top: cope length = (b<sub>f,g</sub> − t<sub>w,g</sub>)/2 + ¾ in, cope depth = k<sub>det,g</sub> + ¼ in. Edge beams are not coped. |
| deck | `Deck_Type`, `selected_deck` | ribs parallel to the girders, flute (concrete rib) centres every pitch from `z = 0`. Pitch / top opening: 1.5VL 6 / 2.5 in, 2VL 12 / 7.0 in, 3VL 12 / 7.25 in. The bottom flat is then set so that average concrete-rib width × rib depth / pitch equals the solver's `Conc_Depth_in_Flute` (0.532414 / 1.0 / 1.5 in), so the drawn rib concrete is the concrete the carbon take-off counts. |
| slab | `selected_deck_topping_thickness`, `Additional_Topping` | topping above the ribs, top at h<sub>r</sub> + t<sub>c</sub> + Δt<sub>c</sub> |
| studs | `min_req_studs_II/IG`, `min_studs_per_rib_II/IG` (composite only) | ¾ in shank, 1¼ × ⅜ in head, height h<sub>r</sub> + 1.5 in. That is the length implied by the solver's stud weights (0.374 / 0.437 / 0.562 lb ≈ 0.4418 in² × 0.2836 lb/in³ × (h<sub>r</sub> + 1.5 in)). On infills they sit in the flutes, spread evenly over the span clear of the copes; on girders (ribs parallel) they are evenly spaced; studs sharing a rib sit side by side across the flange. |
| columns | none (not designed) | translucent W14X90 stubs for context only |

## Floor colours and motion

All colour maps use the paper's colormap (`#4178BE → #85C1E9 → #A3B376 → #FCAE2E → #E57373`).

* **Mode shape** φ(x, z) = (Δ<sub>g</sub> sin(πx/L<sub>g</sub>) + Δ<sub>j</sub> sin(πz/L<sub>j</sub>)) / (Δ<sub>j</sub> + Δ<sub>g</sub>), with
  Δ<sub>j</sub> = `DEF_j` and Δ<sub>g</sub> = `DEF_g` from the solver's DG 11 calculation. It is 0 at the columns,
  Δ<sub>g</sub>/(Δ<sub>j</sub>+Δ<sub>g</sub>) at mid-girder, Δ<sub>j</sub>/(Δ<sub>j</sub>+Δ<sub>g</sub>) at mid-edge-beam and 1 at mid-bay,
  consistent with DG 11's combined-mode frequency f<sub>n</sub> = 0.18 √(g / (Δ<sub>j</sub> + Δ<sub>g</sub>)).
* **Peak accel.** maps a<sub>p</sub>/g × φ (with excitation and response related by reciprocity) and draws the tolerance
  contour. DG 11 reports one a<sub>p</sub>/g at mid-bay; the map shows where the floor moves most, and is an illustration.
* **Deflection** maps (Δ<sub>j</sub> + Δ<sub>g</sub>) φ, the DG 11 static deflections that set f<sub>n</sub>.
* **Vibrate** animates φ at f<sub>n</sub> (slowed down; the deflection scale is exaggerated). **Walk test** moves a
  walker across the bay at the chosen pace, rippling the slab at each footfall, and shows a<sub>p</sub>·φ at the walker.
  **Click to stomp** sends a ripple and reports φ and a<sub>p</sub>·φ at the point. These are visual effects; the
  numbers they show are the solver's DG 11 quantities scaled by φ.
* **B<sub>j</sub> / B<sub>g</sub>** draws the DG 11 effective panel widths (`Bj`, `Bg`) centred on the bay, over the
  neighbouring bays, with the solver's values.
