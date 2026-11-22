"""
Curated view of the solver's variables, for the calculation inspector and the
calculation report.

This file only *names and groups* variables that already exist inside the
paper's ``mitigation_method()``. It contains no arithmetic of its own: every
value shown in the tool is the captured value of the named local, and the code
line shown next to it is read out of the notebook source (``engine.SourceMap``).
Variables not listed here are still shown in the inspector's "All engine
variables" table, so nothing is hidden.

Item tuple: (variable, label, symbol, unit, member)
    member -- which member a shape-table column belongs to when the engine
              computes it once for every W-shape ('infill' / 'girder'); None
              when the variable is already specific to one member or a scalar.
"""

ITEM_FIELDS = ('var', 'label', 'symbol', 'unit', 'member')

# ---------------------------------------------------------------------------
# shared sections
# ---------------------------------------------------------------------------
INPUTS = ('inputs', 'Inputs and design criteria', 'What the solver was given, and the criteria it read from its own tables.', [
    ('Girder_Span', 'Girder span', 'L<sub>g</sub>', 'ft', None),
    ('Infill_Span', 'Infill (beam) span', 'L<sub>j</sub>', 'ft', None),
    ('Conc_Type', 'Concrete type', '', '', None),
    ('conc_density', 'Concrete unit weight', 'w<sub>c</sub>', 'pcf', None),
    ('Deck_Type', 'Deck rib depth', 'h<sub>r</sub>', 'in', None),
    ('Clear_Spans', 'Deck continuity (clear spans)', '', '', None),
    ('percent_comp', 'Partial composite connection', 'PCC', '%', None),
    ('Building_Use', 'Occupancy', '', '', None),
    ('LL', 'Design live load', 'LL', 'psf', None),
    ('SDL', 'Superimposed dead load', 'SDL', 'psf', None),
    ('live_load_vibrations', 'Live load for vibration (DG 11)', 'LL<sub>vib</sub>', 'psf', None),
    ('tolerance_limit', 'Peak acceleration tolerance limit', 'a<sub>0</sub>/g', '%g', None),
    ('DR', 'Damping ratio', '&beta;', '', None),
    ('Es', 'Steel modulus', 'E<sub>s</sub>', 'ksi', None),
    ('Fy', 'Steel yield strength', 'F<sub>y</sub>', 'ksi', None),
    ('f_prime_c', 'Concrete strength', "f'<sub>c</sub>", 'ksi', None),
])

DECK = ('deck', 'Framing layout, deck and slab (Fig. 2)', 'Infill spacing from the deck table limit, then the lightest SDI/Vulcraft deck that carries the slab load at that spacing.', [
    ('max_starting_infill_spacing', 'Max. infill spacing for 22 ga deck, minimum topping', 's<sub>max</sub>', 'ft', None),
    ('NumInfill_unrounded', 'Interior infills (unrounded)', '', '', None),
    ('NumInfill', 'Interior infills in the bay', 'N<sub>j</sub>', '', None),
    ('infill_spacing', 'Infill spacing', 's', 'ft', None),
    ('infill_spacing_rounded', 'Infill spacing, rounded up for deck table', '', 'ft', None),
    ('Additional_Topping', 'Additional topping (mitigation)', '&Delta;t<sub>c</sub>', 'in', None),
    ('Additional_Topping_Load', 'Weight of additional topping', '', 'psf', None),
    ('Conc_Load', 'Superimposed load on deck (LL + SDL + added topping)', '', 'psf', None),
    ('filtered_Decks', 'Deck table rows that pass every deck check', '', '', None),
    ('selected_deck', 'Selected deck', '', '', None),
    ('selected_deck_SW', 'Deck self-weight', 'w<sub>deck</sub>', 'psf', None),
    ('selected_deck_slab_SW', 'Deck + concrete weight (table)', '', 'psf', None),
    ('Final_Slab_SW', 'Slab weight incl. added topping', 'w<sub>slab</sub>', 'psf', None),
    ('selected_deck_topping_thickness', 'Topping above deck (table)', 't<sub>c</sub>', 'in', None),
    ('Final_Slab_Thickness', 'Topping incl. added topping', '', 'in', None),
    ('Final_Deck_Slab_Thickness', 'Total floor depth (deck + topping)', '', 'in', None),
    ('Conc_Depth_in_Flute', 'Equivalent concrete depth in flutes', '', 'in', None),
    ('effective_conc_depth', 'Effective concrete depth', 'd<sub>e,c</sub>', 'in', None),
    ('DL', 'Dead load (slab + SDL)', 'DL', 'psf', None),
])


def _member_loads(m, name):
    s = '_' + m
    if m == 'II':
        return ('loads_II', f'{name}: loads and demands', 'Tributary loads and LRFD demands (1.4D; 1.2D + 1.6L).', [
            ('Trib_II', 'Tributary width', 'b<sub>trib</sub>', 'ft', None),
            ('SW_II', 'Self-weight', 'w<sub>sw</sub>', 'plf', None),
            ('DL_II', 'Dead load incl. self-weight', '', 'psf', None),
            ('W_DL_II', 'Dead load', 'w<sub>D</sub>', 'klf', None),
            ('W_LL_II', 'Live load', 'w<sub>L</sub>', 'klf', None),
            ('W_TL_II', 'Total load', 'w<sub>T</sub>', 'klf', None),
            ('W_Con_DL_II', 'Construction dead load', '', 'klf', None),
            ('W_Con_LL_II', 'Construction live load (20 psf)', '', 'klf', None),
            ('W_CLL_II', 'Composite live load (0.5 LL)', '', 'klf', None),
            ('W_PC_II', 'Pre-composite factored load', '', 'klf', None),
            ('V_PC_II', 'Pre-composite factored shear', 'V<sub>u,pc</sub>', 'kips', None),
            ('V_FL_II', 'Factored shear', 'V<sub>u</sub>', 'kips', None),
            ('M_PC_II', 'Pre-composite factored moment', 'M<sub>u,pc</sub>', 'kip-ft', None),
            ('M_FL_II', 'Factored moment', 'M<sub>u</sub>', 'kip-ft', None),
        ])
    return ('loads_IG', f'{name}: loads and demands', 'Infill reactions as point loads (or a uniform load when there are more than three infills).', [
        ('Trib_IG', 'Tributary width', 'b<sub>trib</sub>', 'ft', None),
        ('SW_IG', 'Self-weight', 'w<sub>sw</sub>', 'plf', None),
        ('Total_SW_II', 'Infill self-weight carried, smeared', '', 'klf', None),
        ('W_Con_DL_IG', 'Construction dead load', '', 'klf', None),
        ('W_PC_IG', 'Pre-composite factored load', '', 'klf', None),
        ('V_DL_IG', 'Dead load shear', '', 'kips', None),
        ('V_LL_IG', 'Live load shear', '', 'kips', None),
        ('V_PC_IG', 'Pre-composite factored shear', 'V<sub>u,pc</sub>', 'kips', None),
        ('V_FL_IG', 'Factored shear', 'V<sub>u</sub>', 'kips', None),
        ('M_SW_IG', 'Self-weight moment', '', 'kip-ft', None),
        ('M_DL_IG', 'Dead load moment', 'M<sub>D</sub>', 'kip-ft', None),
        ('M_LL_IG', 'Live load moment', 'M<sub>L</sub>', 'kip-ft', None),
        ('M_PC_IG', 'Pre-composite factored moment', 'M<sub>u,pc</sub>', 'kip-ft', None),
        ('M_FL_IG', 'Factored moment', 'M<sub>u</sub>', 'kip-ft', None),
    ])


def _composite_section(m, name, L):
    return (f'comp_{m}', f'{name}: composite section (AISC 360 Ch. I)', 'Effective width, stud strength and count, plastic neutral axis case, flexural strength and lower-bound moment of inertia.', [
        (f'b_eff_{m}', 'Effective slab width', 'b<sub>eff</sub>', 'in', None),
        ('tc', 'Concrete above deck used in section', 't<sub>c</sub>', 'in', None),
        ('hr', 'Rib height', 'h<sub>r</sub>', 'in', None),
        (f'Vc_prime_{m}', "Concrete crushing, 0.85 f'c b t", "V'<sub>c</sub>", 'kips', None),
        (f'Vs_prime_{m}', 'Steel yielding, A Fy', "V'<sub>s</sub>", 'kips', None),
        (f'V_prime_{m}', 'Horizontal shear for full composite', "V'", 'kips', None),
        (f'Qn_{m}', 'Stud strength for 1 / 2 / 3 studs per rib', 'Q<sub>n</sub>', 'kips', None),
        (f'max_studs_half_{m}', 'Max studs per half-span for 1 / 2 / 3 per rib', '', '', None),
        (f'max_PCC_{m}', 'Max achievable composite for 1 / 2 / 3 per rib', '', '%', None),
        (f'req_studs_{m}', 'Studs required for 1 / 2 / 3 per rib', '', '', None),
        (f'min_req_studs_{m}', 'Studs on the member', 'N<sub>s</sub>', '', None),
        (f'min_studs_per_rib_{m}', 'Studs per rib', '', '', None),
        (f'selected_Qn_{m}', 'Stud strength used', 'Q<sub>n</sub>', 'kips', None),
        (f'stud_capacity_{m}', 'Total stud capacity', '&Sigma;Q<sub>n</sub>', 'kips', None),
        (f'Sigma_Qn_{m}', 'Shear transfer for this PCC', '&Sigma;Q<sub>n</sub>', 'kips', None),
        (f'a_3_{m}', 'Depth of compression block', 'a', 'in', None),
        (f'Cc_3_{m}', 'Concrete compression force', 'C', 'kips', None),
        (f'Y1_{m}', 'Distance from top of steel to PNA', 'Y1', 'in', None),
        (f'Y2_{m}', 'Distance from top of steel to concrete force', 'Y2', 'in', None),
        (f'case_label_{m}', 'PNA case', '', '', None),
        (f'Phi_Mn_{m}', 'Composite flexural strength', '&phi;M<sub>n</sub>', 'kip-ft', None),
        (f'a_{m}', 'Compression block for I_LB', 'a', 'in', None),
        (f'Y_ENA_{m}', 'Elastic neutral axis (lower bound)', 'Y<sub>ENA</sub>', 'in', None),
        (f'I_LB_{m}', 'Lower-bound moment of inertia', 'I<sub>LB</sub>', 'in<sup>4</sup>', None),
    ])


INFILL_DEFL_C = ('defl_II', 'Infill: deflection and camber', 'Construction deflection on the bare steel, camber = 0.8 x construction deflection (to 1/4 in, only if > 5/8 in and span >= 24 ft), composite deflections on I_LB.', [
    ('infill_Ix', 'Moment of inertia (bare steel)', 'I<sub>x</sub>', 'in<sup>4</sup>', None),
    ('DEF_Con_II', 'Construction dead load deflection', '&Delta;<sub>con</sub>', 'in', None),
    ('camber_II', 'Camber', 'c', 'in', None),
    ('DEF_CDL_II', 'Composite dead load deflection (after camber)', '&Delta;<sub>D</sub>', 'in', None),
    ('DEF_CLL_II', 'Composite live load deflection', '&Delta;<sub>L</sub>', 'in', None),
    ('DEF_CTL_II', 'Composite total load deflection', '&Delta;<sub>T</sub>', 'in', None),
])

GIRDER_DEFL_C = ('defl_IG', 'Girder: deflection and camber', 'Point-load deflection formulas for 1-3 infills, uniform load beyond.', [
    ('DEF_SW_IG', 'Self-weight deflection', '', 'in', None),
    ('DEF_Con_IG', 'Construction dead load deflection', '&Delta;<sub>con</sub>', 'in', None),
    ('camber_IG', 'Camber', 'c', 'in', None),
    ('DEF_CDL_IG', 'Composite dead load deflection (after camber)', '&Delta;<sub>D</sub>', 'in', None),
    ('DEF_CLL_IG', 'Composite live load deflection', '&Delta;<sub>L</sub>', 'in', None),
    ('DEF_CTL_IG', 'Composite total load deflection', '&Delta;<sub>T</sub>', 'in', None),
])

GIRDER_LTB = ('ltb_IG', 'Girder: pre-composite flexure and lateral-torsional buckling', 'Unbraced length = infill spacing, Cb from AISC Table 3-1 for the infill count.', [
    ('Lb', 'Unbraced length', 'L<sub>b</sub>', 'ft', None),
    ('Lp', 'Limiting length, plastic', 'L<sub>p</sub>', 'ft', 'girder'),
    ('Lr', 'Limiting length, inelastic LTB', 'L<sub>r</sub>', 'ft', 'girder'),
    ('Cb', 'Lateral-torsional buckling modifier', 'C<sub>b</sub>', '', None),
    ('Compact', 'Lb <= Lp', '', '', 'girder'),
    ('Noncompact_LTB', 'Inelastic LTB strength', '', 'kip-ft', 'girder'),
    ('Fcr', 'Elastic LTB critical stress', 'F<sub>cr</sub>', 'ksi', 'girder'),
    ('Slender_LTB', 'Elastic LTB strength', '', 'kip-ft', 'girder'),
    ('PhiMn_PC_IG', 'Pre-composite flexural strength', '&phi;M<sub>n</sub>', 'kip-ft', 'girder'),
])

VIBRATION = ('vibration', 'Floor vibration: AISC Design Guide 11, walking (Fig. 4)', 'Transformed sections, beam and girder panel modes, combined frequency, equivalent panel weight and peak acceleration.', [
    ('Ec', 'Concrete modulus, w<sup>1.5</sup>&radic;f\'c', 'E<sub>c</sub>', 'ksi', None),
    ('n', 'Dynamic modular ratio, Es / 1.35 Ec', 'n', '', None),
    ('effective_conc_depth', 'Effective concrete depth', 'd<sub>e,c</sub>', 'in', None),
    ('effective_conc_width', 'Effective slab width, infill', '', 'in', None),
    ('transformed_conc_width', 'Transformed slab width, infill', '', 'in', None),
    ('transformed_conc_area', 'Transformed slab area, infill', '', 'in<sup>2</sup>', None),
    ('y_bar_infill', 'Neutral axis shift, infill', 'y&#772;', 'in', None),
    ('Ij', 'Transformed moment of inertia, infill', 'I<sub>j</sub>', 'in<sup>4</sup>', None),
    ('wj', 'Infill load for vibration', 'w<sub>j</sub>', 'plf', None),
    ('DEF_j', 'Infill deflection', '&Delta;<sub>j</sub>', 'in', None),
    ('fj', 'Beam panel frequency', 'f<sub>j</sub>', 'Hz', None),
    ('de', 'Effective slab depth', 'd<sub>e</sub>', 'in', None),
    ('Ds', 'Slab transformed inertia per unit width', 'D<sub>s</sub>', 'in<sup>4</sup>/ft', None),
    ('Dj', 'Infill transformed inertia per unit width', 'D<sub>j</sub>', 'in<sup>4</sup>/ft', None),
    ('Cj', 'Beam panel coefficient', 'C<sub>j</sub>', '', None),
    ('Bj', 'Beam panel effective width', 'B<sub>j</sub>', 'ft', None),
    ('floor_width_check', '2/3 floor width (limit on Bj)', '', 'ft', None),
    ('Bj_check', 'Bj <= 2/3 floor width', '', '', None),
    ('Wj', 'Beam panel weight', 'W<sub>j</sub>', 'lb', None),
    ('effective_conc_width_girder', 'Effective slab width, girder', '', 'in', None),
    ('transformed_conc_width_girder', 'Transformed slab width, girder', '', 'in', None),
    ('transformed_conc_area_girder', 'Transformed slab area, girder', '', 'in<sup>2</sup>', None),
    ('transformed_conc_area_deck', 'Transformed rib concrete area, girder', '', 'in<sup>2</sup>', None),
    ('y_bar_girder', 'Neutral axis shift, girder', 'y&#772;', 'in', None),
    ('Ig', 'Transformed moment of inertia, girder', 'I<sub>g</sub>', 'in<sup>4</sup>', None),
    ('wg', 'Girder load for vibration', 'w<sub>g</sub>', 'plf', None),
    ('DEF_g', 'Girder deflection', '&Delta;<sub>g</sub>', 'in', None),
    ('fg', 'Girder panel frequency', 'f<sub>g</sub>', 'Hz', None),
    ('Dg', 'Girder transformed inertia per unit width', 'D<sub>g</sub>', 'in<sup>4</sup>/ft', None),
    ('Cg', 'Girder panel coefficient', 'C<sub>g</sub>', '', None),
    ('Bg', 'Girder panel effective width', 'B<sub>g</sub>', 'ft', None),
    ('floor_length_check', '2/3 floor length (limit on Bg)', '', 'ft', None),
    ('Bg_check', 'Bg <= 2/3 floor length', '', '', None),
    ('Wg', 'Girder panel weight', 'W<sub>g</sub>', 'lb', None),
    ('fn', 'Combined (floor) frequency', 'f<sub>n</sub>', 'Hz', None),
    ('girder_deflection_reduction', 'Lg < Bj, girder deflection reduced', '', '', None),
    ('DEF_g_reduced', 'Reduced girder deflection', "&Delta;'<sub>g</sub>", 'in', None),
    ('W', 'Equivalent panel weight', 'W', 'lb', None),
    ('ap_over_g', 'Peak acceleration ratio', 'a<sub>p</sub>/g', '', None),
    ('peak_acceleration', 'Peak acceleration', 'a<sub>p</sub>/g', '%g', None),
    ('vibration_check', 'a<sub>p</sub>/g <= tolerance limit', '', '', None),
])

CARBON_C = ('carbon', 'Embodied carbon take-off (Table 3 factors)', 'The bay is a repeating unit: all interior infills, one edge infill and one girder are counted. Masses in lb, converted to kg before the factors.', [
    ('bay_area', 'Bay area', 'A<sub>bay</sub>', 'ft<sup>2</sup>', None),
    ('steel_w_infill', 'Infill steel', '', 'lb', None),
    ('steel_w_girder', 'Girder steel', '', 'lb', None),
    ('steel_w', 'Structural steel', '', 'lb', None),
    ('steel_deck_w', 'Steel deck', '', 'lb', None),
    ('per_stud_w', 'Weight per stud', '', 'lb', None),
    ('studs_w_infill', 'Studs on counted infills', '', 'lb', None),
    ('studs_w_girder', 'Studs on counted girder', '', 'lb', None),
    ('studs_w', 'Studs', '', 'lb', None),
    ('conc_w', 'Concrete', '', 'lb', None),
    ('Conc_ECV', 'Concrete carbon factor', '', 'kg CO<sub>2</sub>e/kg', None),
    ('EC', 'Embodied carbon of the bay', 'EC', 'kg CO<sub>2</sub>e', None),
    ('EC_scaled', 'Embodied carbon per floor area', 'EC/A', 'kg CO<sub>2</sub>e/ft<sup>2</sup>', None),
])

CARBON_NC = ('carbon', CARBON_C[1], 'The bay is a repeating unit: all interior infills, one edge infill and one girder are counted. Masses in lb, converted to kg before the factors.', [
    it for it in CARBON_C[3] if not it[0].startswith(('studs_w', 'per_stud'))
])

SELECTION = ('selection', 'Member selection (Fig. 3)', 'The optimizer keeps pairs that pass every check below, then picks the lowest embodied carbon.', [
    ('combined_check_II', 'Infill passes every infill check', '', '', None),
    ('combined_check_IG', 'Girder passes every girder check (incl. depth, economic list)', '', '', None),
    ('combined_check', 'Pair passes both', '', '', None),
    ('final_check', 'Pair is a candidate (also lightest of its infill group)', '', '', None),
])

# ---------------------------------------------------------------------------
# limit-state tables: (label, demand, capacity or limit, check variable, unit, clause, kind)
#   kind 'cap'  -- capacity is another captured variable
#   kind 'L360' -- limit is min(L*12/360, 1.0) in, written inline in the check line
#   kind 'L240' -- limit is L*12/240 in
#   kind 'pcc'  -- achievable PCC (max over options) vs requested PCC
#   kind 'flag' -- boolean check only
# ---------------------------------------------------------------------------
CHECKS_C = {
    'infill': [
        ('Pre-composite shear', 'V_PC_II', 'PhiVnx_II', 'pre_composite_V_check_II', 'kips', 'AISC 360 G2', 'cap'),
        ('Pre-composite flexure', 'M_PC_II', 'PhiMpx_II', 'pre_composite_M_check_II', 'kip-ft', 'AISC 360 F2', 'cap'),
        ('Composite shear', 'V_FL_II', 'PhiVnx_II', 'composite_V_check_II', 'kips', 'AISC 360 G2', 'cap'),
        ('Composite flexure', 'M_FL_II', 'Phi_Mn_II', 'composite_M_check_II', 'kip-ft', 'AISC 360 I3', 'cap'),
        ('Composite dead load deflection', 'DEF_CDL_II', 'Infill_Span', 'DL_DEF_check_II', 'in', 'L/360 <= 1 in', 'L360'),
        ('Composite live load deflection', 'DEF_CLL_II', 'Infill_Span', 'LL_DEF_check_II', 'in', 'L/360 <= 1 in', 'L360'),
        ('Composite total load deflection', 'DEF_CTL_II', 'Infill_Span', 'TL_DEF_check_II', 'in', 'L/240', 'L240'),
        ('Studs can reach the requested PCC', 'max_PCC_II', 'percent_comp', 'PCC_check_II', '%', 'stud spacing', 'pcc'),
    ],
    'girder': [
        ('Pre-composite shear', 'V_PC_IG', 'PhiVnx_IG', 'pre_composite_V_check_IG', 'kips', 'AISC 360 G2', 'cap'),
        ('Pre-composite flexure (LTB)', 'M_PC_IG', 'PhiMn_PC_IG', 'pre_composite_M_check_IG', 'kip-ft', 'AISC 360 F2', 'cap'),
        ('Composite shear', 'V_FL_IG', 'PhiVnx_IG', 'composite_V_check_IG', 'kips', 'AISC 360 G2', 'cap'),
        ('Composite flexure', 'M_FL_IG', 'Phi_Mn_IG', 'composite_M_check_IG', 'kip-ft', 'AISC 360 I3', 'cap'),
        ('Composite dead load deflection', 'DEF_CDL_IG', 'Girder_Span', 'DL_DEF_check_IG', 'in', 'L/360 <= 1 in', 'L360'),
        ('Composite live load deflection', 'DEF_CLL_IG', 'Girder_Span', 'LL_DEF_check_IG', 'in', 'L/360 <= 1 in', 'L360'),
        ('Composite total load deflection', 'DEF_CTL_IG', 'Girder_Span', 'TL_DEF_check_IG', 'in', 'L/240', 'L240'),
        ('Studs can reach the requested PCC', 'max_PCC_IG', 'percent_comp', 'PCC_check_flat_IG', '%', 'stud spacing', 'pcc'),
        ('Coped infill fits girder (d - k >= d infill)', 'infill_d', 'girder_d', 'depth_check', 'in', 'detailing', 'depth'),
    ],
    'filters': [
        ('Girder is on the economic-shape list', None, None, 'Eco', '', 'optimizer filter', 'flag'),
        ('Infill is the lightest passing shape of its group', None, None, 'mask', '', 'optimizer filter', 'flag'),
    ],
}

CHECKS_NC = {
    'infill': [
        ('Flexure (bare steel, braced by deck)', 'M_FL_II', 'PhiMn_II', 'Flex_Check_II', 'kip-ft', 'AISC 360 F2', 'cap'),
        ('Shear', 'V_FL_II', 'PhiVnx_II', 'Shear_Sizes_II', 'kips', 'AISC 360 G2', 'cap'),
        ('Live load deflection', 'DEF_LL_II', 'Infill_Span', 'LL_DEF_check_II', 'in', 'L/360 <= 1 in', 'L360'),
        ('Total load deflection', 'DEF_TL_II', 'Infill_Span', 'TL_DEF_check_II', 'in', 'L/240', 'L240'),
    ],
    'girder': [
        ('Flexure (LTB, braced at infills)', 'M_FL_IG', 'PhiMn_IG', 'Flex_Sizes_IG', 'kip-ft', 'AISC 360 F2', 'cap'),
        ('Shear', 'V_FL_IG', 'PhiVnx_IG', 'Shear_Sizes_IG', 'kips', 'AISC 360 G2', 'cap'),
        ('Live load deflection', 'DEF_LL_IG', 'Girder_Span', 'LL_DEF_check_IG', 'in', 'L/360 <= 1 in', 'L360'),
        ('Total load deflection', 'DEF_TL_IG', 'Girder_Span', 'TL_DEF_check_IG', 'in', 'L/240', 'L240'),
        ('Coped infill fits girder (d - k >= d infill)', 'infill_d', 'girder_d', 'depth_check', 'in', 'detailing', 'depth'),
    ],
    'filters': [
        ('Girder is on the economic-shape list', None, None, 'Eco', '', 'optimizer filter', 'flag'),
        ('Infill is the lightest passing shape of its group', None, None, 'mask', '', 'optimizer filter', 'flag'),
    ],
}

INFILL_NC_SECTION = ('nc_II', 'Infill: non-composite strength and deflection', 'Bare steel; the deck braces the top flange so the plastic moment governs.', [
    ('PhiMn_II', 'Flexural strength', '&phi;M<sub>n</sub>', 'kip-ft', None),
    ('PhiVnx_II', 'Shear strength', '&phi;V<sub>n</sub>', 'kips', None),
    ('Ix_II', 'Moment of inertia', 'I<sub>x</sub>', 'in<sup>4</sup>', None),
    ('DEF_LL_II', 'Live load deflection', '&Delta;<sub>L</sub>', 'in', None),
    ('DEF_TL_II', 'Total load deflection', '&Delta;<sub>T</sub>', 'in', None),
])

GIRDER_NC_SECTION = ('nc_IG', 'Girder: non-composite strength and deflection', 'Unbraced length = infill spacing, Cb from AISC Table 3-1.', [
    ('Lb', 'Unbraced length', 'L<sub>b</sub>', 'ft', None),
    ('Lp', 'Limiting length, plastic', 'L<sub>p</sub>', 'ft', 'girder'),
    ('Lr', 'Limiting length, inelastic LTB', 'L<sub>r</sub>', 'ft', 'girder'),
    ('Cb', 'Lateral-torsional buckling modifier', 'C<sub>b</sub>', '', None),
    ('PhiMn_IG', 'Flexural strength', '&phi;M<sub>n</sub>', 'kip-ft', None),
    ('PhiVnx_IG', 'Shear strength', '&phi;V<sub>n</sub>', 'kips', None),
    ('DEF_SW_IG', 'Self-weight deflection', '', 'in', None),
    ('DEF_LL_IG', 'Live load deflection', '&Delta;<sub>L</sub>', 'in', None),
    ('DEF_TL_IG', 'Total load deflection', '&Delta;<sub>T</sub>', 'in', None),
])


def _loads_nc_infill():
    sec = _member_loads('II', 'Infill')
    keep = {'Trib_II', 'SW_II', 'DL_II', 'W_DL_II', 'W_LL_II', 'W_TL_II', 'V_FL_II', 'M_FL_II'}
    return (sec[0], sec[1], sec[2], [i for i in sec[3] if i[0] in keep])


def _loads_nc_girder():
    sec = _member_loads('IG', 'Girder')
    drop = {'W_Con_DL_IG', 'W_PC_IG', 'V_PC_IG', 'M_PC_IG'}
    return (sec[0], sec[1], sec[2], [i for i in sec[3] if i[0] not in drop])


SECTIONS = {
    'composite': [
        INPUTS, DECK,
        _composite_section('II', 'Infill', 'Infill_Span'), _member_loads('II', 'Infill'), INFILL_DEFL_C,
        _composite_section('IG', 'Girder', 'Girder_Span'), _member_loads('IG', 'Girder'), GIRDER_LTB, GIRDER_DEFL_C,
        SELECTION, VIBRATION, CARBON_C,
    ],
    'noncomposite': [
        INPUTS, DECK,
        _loads_nc_infill(), INFILL_NC_SECTION,
        _loads_nc_girder(), GIRDER_NC_SECTION,
        SELECTION, VIBRATION, CARBON_NC,
    ],
}
CHECKS = {'composite': CHECKS_C, 'noncomposite': CHECKS_NC}


def calc_map(system: str, smap) -> dict:
    """Sections + checks with each variable's source lines attached."""
    sections = []
    for sid, title, blurb, items in SECTIONS[system]:
        rows = []
        for it in items:
            d = dict(zip(ITEM_FIELDS, it))
            d['code'] = smap.assignments.get(d['var'], [])
            rows.append(d)
        sections.append({'id': sid, 'title': title, 'blurb': blurb, 'items': rows})
    checks = {}
    for grp, items in CHECKS[system].items():
        checks[grp] = []
        for label, demand, cap, flag, unit, clause, kind in items:
            checks[grp].append({'label': label, 'demand': demand, 'capacity': cap, 'flag': flag,
                                'unit': unit, 'clause': clause, 'kind': kind,
                                'code': smap.assignments.get(flag, [])})
    return {'sections': sections, 'checks': checks}
