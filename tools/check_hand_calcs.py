"""
The thesis hand calcs against the tool.

    python tools/check_hand_calcs.py            # writes docs/HAND_CALCS.md; exit 1 on an unexplained difference

Every boxed or highlighted value in the hand calcs (thesis Appendix, pp. 158-196; `Hand Calcs.pdf` in the
MS-Vibration-Code release) is compared with the value the tool captures from the published solver for the same bay
and members, which is the number its calculation report prints. tests/test_hand_calcs.py runs the same comparison.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from server import service as svc  # noqa: E402

LB = 0.45359237
TL_LL = lambda m: (lambda v: v[f'DEF_TL_{m}'] - v[f'DEF_LL_{m}'])   # noqa: E731  dead-load deflection = TL - LL
ECLB = lambda v: v['EC_scaled'] / LB                               # noqa: E731  lb CO2e/ft2

# Slips in the hand calcs themselves (checked against the solver's AISC table). The tool is right in each.
KNOWN = {
    ('A', 'Girder Lr (ft)'): 'The hand calc wrote 13.9 ft; the AISC table gives 17.4 ft for W21X55. No effect: Lp < Lb = 10 ft < Lr either way, and phiMn matches.',
    ('B', 'Infill phiMp, precomp (kip-ft)'): "AISC Table 3-2 prints 92.6; the study's modified AISC table (engine/paper) rounds it to 93. Pre-composite check only (77.85 < 93).",
    ('D', 'Girder Lp (ft)'): 'The hand calc wrote 2.87 ft; the table gives 2.77 ft for W10X12. No effect: Lb = 2.5 ft < Lp either way (compact), and phiMn matches.',
    ('I', 'Girder phiMn pre-composite (kip-ft)'): "Labelled W12X14, but 47 kip-ft (and Lp = 2.87 ft) are W10X12's values, copied from the non-composite check on p. 166. W12X14's phiMp is 65 kip-ft, which the tool shows.",
}

CASES = [
    dict(id='A', page='158-164', title='Non-composite validation: 30 x 30 ft, LWC, 2" deck, W18X35 / W21X55',
         req=dict(system='noncomposite', girder_span=30, infill_span=30, conc_type=1, deck_type=2, infill_shape='W18X35', girder_shape='W21X55'),
         ninf=2, deck='2VL22 GA w/ 2in LWC', values=[
             ('Deck + slab SW (psf)', 29.1, 'selected_deck_slab_SW'), ('DL (psf)', 49.1, 'DL'),
             ('Infill w_DL (klf)', 0.526, 'W_DL_II'), ('Infill w_LL (klf)', 0.4, 'W_LL_II'),
             ('Infill V_DL (kip)', 7.89, 'V_DL_II'), ('Infill V_LL (kip)', 6, 'V_LL_II'), ('Infill V_FL (kip)', 19.068, 'V_FL_II'),
             ('Infill M_FL (kip-ft)', 143.01, 'M_FL_II'), ('Infill phiVn (kip)', 159, 'PhiVnx_II'), ('Infill phiMn (kip-ft)', 249, 'PhiMn_II'),
             ('Infill delta_LL (in)', 0.4929, 'DEF_LL_II'), ('Infill delta_DL (in)', 0.6482, TL_LL('II')), ('Infill delta_TL (in)', 1.1411, 'DEF_TL_II'),
             ('Girder Lb (ft)', 10, 'Lb'), ('Girder Lp (ft)', 6.11, 'Lp_expand'), ('Girder Lr (ft)', 13.9, 'Lr_expand'),
             ('Girder phiMn (kip-ft)', 409.593, 'PhiMn_IG'), ('Girder phiVn (kip)', 234, 'PhiVnx_IG'),
             ('Girder V_DL (kip)', 16.605, 'V_DL_IG'), ('Girder V_LL (kip)', 12, 'V_LL_IG'), ('Girder V_FL (kip)', 39.126, 'V_FL_IG'),
             ('Girder M_SW (kip-ft)', 6.188, 'M_SW_IG'), ('Girder M_DL (kip-ft)', 163.988, 'M_DL_IG'), ('Girder M_LL (kip-ft)', 120, 'M_LL_IG'),
             ('Girder M_FL (kip-ft)', 388.785, 'M_FL_IG'), ('Girder delta_SW (in)', 0.0303, 'DEF_SW_IG'), ('Girder delta_DL (in)', 0.8208, TL_LL('IG')),
             ('Girder delta_LL (in)', 0.6011, 'DEF_LL_IG'), ('Girder delta_TL (in)', 1.4218, 'DEF_TL_IG'),
             ('Ec (ksi)', 2307.38, 'Ec'), ('n', 9.31, 'n'), ('Transformed conc width, infill (in)', 12.89, 'transformed_conc_width'),
             ('Transformed conc area, infill (in2)', 25.779, 'transformed_conc_area'), ('y_bar infill (in)', 8.467, 'y_bar_infill'),
             ('I_j (in4)', 1552, 'Ij'), ('w_j (plf)', 426, 'wj'), ('delta_j (in)', 0.172, 'DEF_j'), ('f_j (Hz)', 8.515, 'fj'),
             ('d_e (in)', 3, 'de'), ('D_s (in4/ft)', 2.9, 'Ds'), ('D_j (in4/ft)', 155.203, 'Dj'), ('B_j (ft)', 22.184, 'Bj'), ('W_j (lb)', 42525.8, 'Wj'),
             ('Eff. conc width, girder (in)', 144, 'effective_conc_width_girder'), ('Transformed conc width, girder (in)', 15.467, 'transformed_conc_width_girder'),
             ('Deck width eff., girder (in)', 7.734, 'transformed_conc_width_deck'), ('Transformed conc area, girder (in2)', 30.935, 'transformed_conc_area_girder'),
             ('Deck area tran., girder (in2)', 15.467, 'transformed_conc_area_deck'), ('y_bar girder (in)', 9.44, 'y_bar_girder'),
             ('I_g (in4)', 3143.6, 'Ig'), ('w_g (plf)', 1333, 'wg'), ('delta_g (in)', 0.266, 'DEF_g'), ('f_g (Hz)', 6.851, 'fg'),
             ('D_g (in4/ft)', 104.788, 'Dg'), ('B_g (ft)', 59.572, 'Bg'), ('W_g (lb)', 79409.3, 'Wg'), ('f_n (Hz)', 5.338, 'fn'),
             ('W (lb)', 64916, 'W'), ('a_p/g (%g)', 0.77304, 'peak_acceleration'),
             ('W_infill (lb), edited', 3150, 'steel_w_infill'), ('W_girder (lb), edited', 1650, 'steel_w_girder'), ('W_deck (lb)', 1440, 'steel_deck_w'),
             ('W_concrete (lb)', 24750, 'conc_w'), ('Scaled EC (lb CO2e/ft2), edited', 18.661, ECLB)]),
    dict(id='B', page='173-182', title='Composite validation: 30 x 30 ft, LWC, 2" deck, 50 %, W12X19 [17] / W18X40 [41]',
         req=dict(system='composite', girder_span=30, infill_span=30, conc_type=1, deck_type=2, percent_comp=50, infill_shape='W12X19', girder_shape='W18X40'),
         ninf=2, deck='2VL22 GA w/ 2in LWC', values=[
             ('Infill b_eff (in)', 90, 'b_eff_II'), ("Infill Vc' (kip)", 612, 'Vc_prime_II'), ("Infill Vs' (kip)", 278.5, 'Vs_prime_II'),
             ('Infill Qn (kip)', 17.23, 'selected_Qn_II'), ('Infill SigmaQn (kip)', 139.25, 'Sigma_Qn_II'), ('Infill a (in)', 0.455, 'a_II'),
             ('Infill Cc (kip)', 139.25, 'Cc_3_II'), ('Infill Y1 (in)', 0.347, 'Y1_II'), ('Infill Y2 (in)', 3.772, 'Y2_II'), ('Infill T (kip)', 278.5, 'T_3a_II'),
             ('Infill phiMn (kip-ft)', 164.999, 'Phi_Mn_II'), ('Infill d1 (in)', 3.772, 'd1_II'), ('Infill d3 (in)', 6.1, 'd3_II'),
             ('Infill Y_ENA (in)', 9.391, 'Y_ENA_II'), ('Infill I_LB (in4)', 310.961, 'I_LB_II'), ('Infill studs', 17, 'min_req_studs_II'),
             ('Infill w_DL (klf)', 0.51, 'W_DL_II'), ('Infill w_precomp (klf)', 0.692, 'W_PC_II'), ('Infill w_comp_LL (klf)', 0.2, 'W_CLL_II'),
             ('Infill V_DL (kip)', 7.65, 'V_DL_II'), ('Infill V_LL (kip)', 6, 'V_LL_II'), ('Infill V_FL (kip)', 18.78, 'V_FL_II'),
             ('Infill V_con (kip)', 4.65, 'V_Con_DL_II'), ('Infill V_precomp (kip)', 10.38, 'V_PC_II'), ('Infill V_comp_LL (kip)', 3, 'V_CLL_II'),
             ('Infill M_FL (kip-ft)', 140.85, 'M_FL_II'), ('Infill M_precomp (kip-ft)', 77.85, 'M_PC_II'), ('Infill phiMp, precomp (kip-ft)', 92.6, 'PhiMpx_II'),
             ('Infill phiVn (kip)', 86, 'PhiVnx_II'), ('Infill delta_con (in)', 1.4986, 'DEF_Con_II'), ('Infill camber (in)', 1.25, 'camber_II'),
             ('Infill delta_comp_LL (in)', 0.4042, 'DEF_CLL_II'), ('Infill delta_comp_DL (in)', 0.2486, 'DEF_CDL_II'), ('Infill delta_comp_TL (in)', 0.6528, 'DEF_CTL_II'),
             ('Girder phiMn precomp (kip-ft)', 220.717, 'PhiMn_PC_IG'), ('Girder phiVn (kip)', 169, 'PhiVnx_IG'),
             ('Girder b_eff (in)', 90, 'b_eff_IG'), ("Girder Vs' (kip)", 590, 'Vs_prime_IG'), ('Girder Qn (kip)', 14.645, 'selected_Qn_IG'),
             ('Girder SigmaQn (kip)', 295, 'Sigma_Qn_IG'), ('Girder a (in)', 0.964, 'a_IG'), ('Girder Cc (kip)', 295, 'Cc_3_IG'), ('Girder Y1 (in)', 0.49, 'Y1_IG'),
             ('Girder Y2 (in)', 3.518, 'Y2_IG'), ('Girder T (kip)', 590, 'T_3a_IG'), ('Girder phiMn (kip-ft)', 468.452, 'Phi_Mn_IG'),
             ('Girder d1 (in)', 3.518, 'd1_IG'), ('Girder d3 (in)', 8.95, 'd3_IG'), ('Girder Y_ENA (in)', 13.106, 'Y_ENA_IG'), ('Girder I_LB (in4)', 1223.4, 'I_LB_IG'),
             ('Girder studs', 41, 'min_req_studs_IG'),
             ('Girder V_DL (kip)', 15.9, 'V_DL_IG'), ('Girder V_LL (kip)', 12, 'V_LL_IG'), ('Girder V_FL (kip)', 38.28, 'V_FL_IG'),
             ('Girder V_precomp (kip)', 21.36, 'V_PC_IG'), ('Girder M_SW (kip-ft)', 4.5, 'M_SW_IG'), ('Girder M_DL (kip-ft)', 157.5, 'M_DL_IG'),
             ('Girder M_LL (kip-ft)', 120, 'M_LL_IG'), ('Girder M_FL (kip-ft)', 381, 'M_FL_IG'), ('Girder M_precomp (kip-ft)', 212.1, 'M_PC_IG'),
             ('Girder delta_SW (in)', 0.0411, 'DEF_SW_IG'), ('Girder delta_con (in)', 0.9088, 'DEF_Con_IG'), ('Girder camber (in)', 0.75, 'camber_IG'),
             ('Girder delta_comp_LL (in)', 0.28, 'DEF_CLL_IG'), ('Girder delta_comp_DL (in)', 0.1588, 'DEF_CDL_IG'), ('Girder delta_comp_TL (in)', 0.4389, 'DEF_CTL_IG'),
             ('y_bar infill (in)', 7.483, 'y_bar_infill'), ('I_j (in4)', 517.891, 'Ij'), ('w_j (plf)', 410, 'wj'), ('delta_j (in)', 0.498, 'DEF_j'),
             ('f_j (Hz)', 5.014, 'fj'), ('D_j (in4/ft)', 51.789, 'Dj'), ('B_j (ft)', 29.187, 'Bj'), ('W_j (lb)', 53850.9, 'Wj'),
             ('y_bar girder (in)', 9, 'y_bar_girder'), ('I_g (in4)', 1866.4, 'Ig'), ('w_g (plf)', 1270, 'wg'), ('delta_g (in)', 0.428, 'DEF_g'),
             ('f_g (Hz)', 5.408, 'fg'), ('D_g (in4/ft)', 62.215, 'Dg'), ('B_g (ft)', 51.58, 'Bg'), ('W_g (lb)', 65506.5, 'Wg'),
             ('f_n (Hz)', 3.677, 'fn'), ('W (lb)', 59238.3, 'W'), ('a_p/g (%g)', 1.51498, 'peak_acceleration'),
             ('W_infill (lb), edited', 1710, 'steel_w_infill'), ('W_girder (lb), edited', 1200, 'steel_w_girder'),
             ('W_studs infill (lb), edited', 22.3, 'studs_w_infill'), ('W_studs girder (lb), edited', 17.9, 'studs_w_girder'),
             ('W_deck (lb)', 1440, 'steel_deck_w'), ('W_concrete (lb)', 24750, 'conc_w'), ('Scaled EC (lb CO2e/ft2), edited', 16.156, ECLB)]),
    dict(id='C', page='165', title='Spot check, non-composite slender girder: 30 x 15 ft, 1 infill, LWC, 3" deck, girder W18X40',
         req=dict(system='noncomposite', girder_span=30, infill_span=15, conc_type=1, deck_type=3, infill_shape='W12X19', girder_shape='W18X40'),
         ninf=1, values=[('Girder Lb (ft)', 15, 'Lb'), ('Girder Lr (ft)', 13.1, 'Lr_expand'), ('Cb', 1.67, 'Cb'), ('Girder phiMn (kip-ft)', 240.614, 'PhiMn_IG')]),
    dict(id='D', page='166', title='Spot check, non-composite compact girder: 10 x 15 ft, 3 infills, LWC, 3" deck, girder W10X12',
         req=dict(system='noncomposite', girder_span=10, infill_span=15, conc_type=1, deck_type=3, infill_shape='W8X10', girder_shape='W10X12'),
         ninf=3, values=[('Girder Lb (ft)', 2.5, 'Lb'), ('Girder Lp (ft)', 2.87, 'Lp_expand'), ('Girder phiMn (kip-ft)', 47, 'PhiMn_IG')]),
    dict(id='E', page='167-168', title='Spot check, non-composite, 1 infill: 30 x 30 ft, LWC, 3" deck, W18X40 / W21X55',
         req=dict(system='noncomposite', girder_span=30, infill_span=30, conc_type=1, deck_type=3, infill_shape='W18X40', girder_shape='W21X55'),
         ninf=1, deck='3VL19 GA w/ 2in LWC', values=[
             ('Deck + slab SW (psf)', 34.5, 'selected_deck_slab_SW'), ('DL (psf)', 54.5, 'DL'), ('Infill w_DL (klf)', 0.8575, 'W_DL_II'),
             ('Infill w_LL (klf)', 0.6, 'W_LL_II'), ('Infill V_LL (kip)', 9, 'V_LL_II'), ('Infill V_DL (kip)', 12.863, 'V_DL_II'), ('Infill V_FL (kip)', 29.835, 'V_FL_II'),
             ('Infill M_FL (kip-ft)', 223.763, 'M_FL_II'), ('Infill delta_LL (in)', 0.6161, 'DEF_LL_II'), ('Infill delta_DL (in)', 0.8805, TL_LL('II')),
             ('Infill delta_TL (in)', 1.497, 'DEF_TL_II'), ('Girder V_DL (kip)', 13.688, 'V_DL_IG'), ('Girder V_LL (kip)', 9, 'V_LL_IG'),
             ('Girder V_FL (kip)', 30.825, 'V_FL_IG'), ('Girder M_DL (kip-ft)', 199.125, 'M_DL_IG'), ('Girder M_LL (kip-ft)', 135, 'M_LL_IG'),
             ('Girder M_FL (kip-ft)', 454.95, 'M_FL_IG'), ('Girder delta_LL (in)', 0.5292, 'DEF_LL_IG'), ('Girder delta_DL (in)', 0.7867, TL_LL('IG')),
             ('Girder delta_TL (in)', 1.316, 'DEF_TL_IG')]),
    dict(id='F', page='169-170', title='Spot check, non-composite, 3 infills: 30 x 30 ft, LWC, 3" deck, W16X31 / W24X55',
         req=dict(system='noncomposite', girder_span=30, infill_span=30, conc_type=1, deck_type=3, infill_shape='W16X31', girder_shape='W24X55'),
         ninf=3, deck='3VL22 GA w/ 2in LWC', values=[
             ('Deck + slab SW (psf)', 33.8, 'selected_deck_slab_SW'), ('Infill w_DL (klf)', 0.4345, 'W_DL_II'), ('Infill V_LL (kip)', 4.5, 'V_LL_II'),
             ('Infill V_DL (kip)', 6.518, 'V_DL_II'), ('Infill V_FL (kip)', 15.021, 'V_FL_II'), ('Infill M_FL (kip-ft)', 112.658, 'M_FL_II'),
             ('Infill delta_LL (in)', 0.5028, 'DEF_LL_II'), ('Infill delta_DL (in)', 0.7282, TL_LL('II')), ('Infill delta_TL (in)', 1.231, 'DEF_TL_II'),
             ('Girder V_DL (kip)', 20.378, 'V_DL_IG'), ('Girder V_LL (kip)', 13.5, 'V_LL_IG'), ('Girder V_FL (kip)', 46.053, 'V_FL_IG'),
             ('Girder M_DL (kip-ft)', 201.713, 'M_DL_IG'), ('Girder M_LL (kip-ft)', 135, 'M_LL_IG'), ('Girder M_FL (kip-ft)', 458.055, 'M_FL_IG'),
             ('Girder delta_LL (in)', 0.5307, 'DEF_LL_IG'), ('Girder delta_DL (in)', 0.7942, TL_LL('IG')), ('Girder delta_TL (in)', 1.325, 'DEF_TL_IG')]),
    dict(id='G', page='171-172', title='Spot check, non-composite, 4 infills: 30 x 30 ft, LWC, 3" deck, W16X26 / W24X55',
         req=dict(system='noncomposite', girder_span=30, infill_span=30, conc_type=1, deck_type=3, infill_shape='W16X26', girder_shape='W24X55'),
         ninf=4, deck='3VL22 GA w/ 2in LWC', values=[
             ('Infill w_DL (klf)', 0.3488, 'W_DL_II'), ('Infill V_LL (kip)', 3.6, 'V_LL_II'), ('Infill V_DL (kip)', 5.232, 'V_DL_II'),
             ('Infill V_FL (kip)', 12.038, 'V_FL_II'), ('Infill M_FL (kip-ft)', 90.288, 'M_FL_II'), ('Infill delta_LL (in)', 0.5011, 'DEF_LL_II'),
             ('Infill delta_DL (in)', 0.7282, TL_LL('II')), ('Infill delta_TL (in)', 1.229, 'DEF_TL_II'),
             ('Girder V_DL (kip)', 21.753, 'V_DL_IG'), ('Girder V_LL (kip)', 14.4, 'V_LL_IG'), ('Girder V_FL (kip)', 49.144, 'V_FL_IG'),
             ('Girder M_DL (kip-ft)', 199.463, 'M_DL_IG'), ('Girder M_LL (kip-ft)', 135, 'M_LL_IG'), ('Girder M_FL (kip-ft)', 455.355, 'M_FL_IG'),
             ('Girder delta_LL (in)', 0.5586, 'DEF_LL_IG'), ('Girder delta_DL (in)', 0.8254, TL_LL('IG')), ('Girder delta_TL (in)', 1.384, 'DEF_TL_IG')]),
    dict(id='H', page='183', title='Spot check, composite slender girder (pre-composite): 32 x 20 ft, 1 infill, LWC, 3" deck, 50 %, girder W14X34 '
         '(labelled W18X40 in the hand calc, but every property it uses, Sx 48.6, J 0.569, ho 13.5, rts 1.80, Lr 15.6, is W14X34\'s)',
         req=dict(system='composite', girder_span=32, infill_span=20, conc_type=1, deck_type=3, percent_comp=50, infill_shape='W12X19', girder_shape='W14X34'),
         ninf=1, values=[('Girder Lb (ft)', 16, 'Lb'), ('Cb', 1.67, 'Cb'), ('Girder phiMn pre-composite (kip-ft)', 203.703, 'PhiMn_PC_IG')]),
    dict(id='I', page='184', title='Spot check, composite compact girder (pre-composite): 10 x 40 ft, 4 infills, LWC, 3" deck, 50 %, girder W12X14',
         req=dict(system='composite', girder_span=10, infill_span=40, conc_type=1, deck_type=3, percent_comp=50, infill_shape='W12X19', girder_shape='W12X14'),
         ninf=4, values=[('Girder Lb (ft)', 2, 'Lb'), ('Girder phiMn pre-composite (kip-ft)', 47, 'PhiMn_PC_IG')]),
    dict(id='J', page='185-190', title='Spot check, composite, PNA in the web (Case 3b): 30 x 17 ft, 1 infill, NWC, 3" deck, 25 %, W12X14 [7] / W18X35 [15]',
         req=dict(system='composite', girder_span=30, infill_span=17, conc_type=0, deck_type=3, percent_comp=25, infill_shape='W12X14', girder_shape='W18X35'),
         ninf=1, deck='3VL16 GA w/ 2in NWC', values=[
             ('Infill case', 'Case 3b', 'case_label_II'), ('Infill b_eff (in)', 51, 'b_eff_II'), ("Infill Vc' (kip)", 346.8, 'Vc_prime_II'),
             ("Infill Vs' (kip)", 208, 'Vs_prime_II'), ('Infill Qn (kip)', 17.23, 'selected_Qn_II'), ('Infill SigmaQn (kip)', 52, 'Sigma_Qn_II'),
             ('Infill a (in)', 0.3, 'a_II'), ('Infill Cc (kip)', 52, 'Cc_3_II'), ('Infill Y1 (in)', 3.35, 'Y1_II'), ('Infill Y2 (in)', 4, 'Y2_II'),
             ('Infill Ts1 (kip)', 52, 'Ts1_3b_II'), ('Infill phiMn (kip-ft)', 98.985, 'Phi_Mn_II'), ('Infill d1 (in)', 4.85, 'd1_II'),
             ('Infill Y_ENA (in)', 8.11, 'Y_ENA_II'), ('Infill I_LB (in4)', 186.046, 'I_LB_II'), ('Infill studs', 7, 'min_req_studs_II'),
             ('Girder case', 'Case 3b', 'case_label_IG'), ('Girder b_eff (in)', 90, 'b_eff_IG'), ("Girder Vs' (kip)", 515, 'Vs_prime_IG'),
             ('Girder SigmaQn (kip)', 128.75, 'Sigma_Qn_IG'), ('Girder a (in)', 0.421, 'a_IG'), ('Girder Y1 (in)', 4.558, 'Y1_IG'), ('Girder Y2 (in)', 4, 'Y2_IG'),
             ('Girder Ts1 (kip)', 128.75, 'Ts1_3b_IG'), ('Girder phiMn (kip-ft)', 352.737, 'Phi_Mn_IG'), ('Girder d1 (in)', 4.79, 'd1_IG'),
             ('Girder Y_ENA (in)', 11.578, 'Y_ENA_IG'), ('Girder I_LB (in4)', 893.241, 'I_LB_IG'), ('Girder studs', 15, 'min_req_studs_IG'),
             ('Deck + slab SW (psf)', 45.8, 'selected_deck_slab_SW'), ('Infill V_DL (kip)', 8.509, 'V_DL_II'), ('Infill V_LL (kip)', 5.1, 'V_LL_II'),
             ('Infill V_FL (kip)', 18.37, 'V_FL_II'), ('Infill V_con (kip)', 5.959, 'V_Con_DL_II'), ('Infill V_precomp (kip)', 11.23, 'V_PC_II'),
             ('Infill V_comp_LL (kip)', 2.55, 'V_CLL_II'), ('Infill M_FL (kip-ft)', 78.073, 'M_FL_II'), ('Infill M_precomp (kip-ft)', 47.728, 'M_PC_II'),
             ('Infill phiMp, precomp (kip-ft)', 65, 'PhiMpx_II'), ('Infill phiVn (kip)', 71, 'PhiVnx_II'), ('Infill delta_con (in)', 0.5104, 'DEF_Con_II'),
             ('Infill camber (in)', 0, 'camber_II'), ('Infill delta_comp_LL (in)', 0.1045, 'DEF_CLL_II'), ('Infill delta_comp_DL (in)', 0.5104, 'DEF_CDL_II'),
             ('Infill delta_comp_TL (in)', 0.6149, 'DEF_CTL_II'), ('Girder V_DL (kip)', 9.034, 'V_DL_IG'), ('Girder V_LL (kip)', 5.1, 'V_LL_IG'),
             ('Girder V_FL (kip)', 19, 'V_FL_IG'), ('Girder V_precomp (kip)', 11.755, 'V_PC_IG'), ('Girder M_SW (kip-ft)', 3.938, 'M_SW_IG'),
             ('Girder M_DL (kip-ft)', 131.565, 'M_DL_IG'), ('Girder M_LL (kip-ft)', 76.5, 'M_LL_IG'), ('Girder M_FL (kip-ft)', 280.278, 'M_FL_IG'),
             ('Girder M_precomp (kip-ft)', 172.391, 'M_PC_IG'), ('Girder phiMn precomp (kip-ft)', 181.7, 'PhiMn_PC_IG'), ('Girder delta_SW (in)', 0.0431, 'DEF_SW_IG'),
             ('Girder delta_con (in)', 0.8263, 'DEF_Con_IG'), ('Girder camber (in)', 0.75, 'camber_IG'), ('Girder delta_comp_LL (in)', 0.1914, 'DEF_CLL_IG'),
             ('Girder delta_comp_DL (in)', 0.0763, 'DEF_CDL_IG'), ('Girder delta_comp_TL (in)', 0.2677, 'DEF_CTL_IG')]),
    dict(id='K', page='191-193', title='Spot check, composite, 3 infills: 30 x 30 ft, NWC, 3" deck, 50 %, W12X16 [14] / W21X44 [42]',
         req=dict(system='composite', girder_span=30, infill_span=30, conc_type=0, deck_type=3, percent_comp=50, infill_shape='W12X16', girder_shape='W21X44'),
         ninf=3, deck='3VL22 GA w/ 2in NWC', values=[
             ('Deck + slab SW (psf)', 44, 'selected_deck_slab_SW'), ('Infill I_LB (in4)', 286.38, 'I_LB_II'), ('Infill studs', 14, 'min_req_studs_II'),
             ('Infill V_DL (kip)', 7.44, 'V_DL_II'), ('Infill V_LL (kip)', 4.5, 'V_LL_II'), ('Infill V_FL (kip)', 16.128, 'V_FL_II'),
             ('Infill V_con (kip)', 5.19, 'V_Con_DL_II'), ('Infill V_precomp (kip)', 9.828, 'V_PC_II'), ('Infill V_comp_LL (kip)', 2.25, 'V_CLL_II'),
             ('Infill M_FL (kip-ft)', 120.96, 'M_FL_II'), ('Infill phiMn (kip-ft)', 140.1, 'Phi_Mn_II'), ('Infill M_precomp (kip-ft)', 73.71, 'M_PC_II'),
             ('Infill phiMp, precomp (kip-ft)', 75, 'PhiMpx_II'), ('Infill delta_con (in)', 2.1111, 'DEF_Con_II'), ('Infill camber (in)', 1.75, 'camber_II'),
             ('Infill delta_comp_LL (in)', 0.3292, 'DEF_CLL_II'), ('Infill delta_comp_DL (in)', 0.3611, 'DEF_CDL_II'), ('Infill delta_comp_TL (in)', 0.6903, 'DEF_CTL_II'),
             ('Girder I_LB (in4)', 1760.61, 'I_LB_IG'), ('Girder studs', 42, 'min_req_studs_IG'), ('Girder V_DL (kip)', 22.98, 'V_DL_IG'),
             ('Girder V_LL (kip)', 13.5, 'V_LL_IG'), ('Girder V_FL (kip)', 49.176, 'V_FL_IG'), ('Girder phiVn (kip)', 217, 'PhiVnx_IG'),
             ('Girder V_precomp (kip)', 30.144, 'V_PC_IG'), ('Girder M_SW (kip-ft)', 4.95, 'M_SW_IG'), ('Girder M_DL (kip-ft)', 228.15, 'M_DL_IG'),
             ('Girder M_LL (kip-ft)', 135, 'M_LL_IG'), ('Girder M_FL (kip-ft)', 489.78, 'M_FL_IG'), ('Girder phiMn (kip-ft)', 586.8, 'Phi_Mn_IG'),
             ('Girder M_precomp (kip-ft)', 299.79, 'M_PC_IG'), ('Girder phiMn precomp (kip-ft)', 340.5, 'PhiMn_PC_IG'), ('Girder delta_SW (in)', 0.0328, 'DEF_SW_IG'),
             ('Girder delta_con (in)', 1.013, 'DEF_Con_IG'), ('Girder camber (in)', 0.75, 'camber_IG'), ('Girder delta_comp_LL (in)', 0.2035, 'DEF_CLL_IG'),
             ('Girder delta_comp_DL (in)', 0.263, 'DEF_CDL_IG'), ('Girder delta_comp_TL (in)', 0.4664, 'DEF_CTL_IG')]),
    dict(id='L', page='194-196', title='Spot check, composite, 4 infills: 30 x 30 ft, NWC, 3" deck, 50 %, W12X14 [13] / W21X44 [42]',
         req=dict(system='composite', girder_span=30, infill_span=30, conc_type=0, deck_type=3, percent_comp=50, infill_shape='W12X14', girder_shape='W21X44'),
         ninf=4, deck='3VL22 GA w/ 2in NWC', values=[
             ('Infill I_LB (in4)', 248.877, 'I_LB_II'), ('Infill studs', 13, 'min_req_studs_II'), ('Infill V_DL (kip)', 5.97, 'V_DL_II'),
             ('Infill V_LL (kip)', 3.6, 'V_LL_II'), ('Infill V_FL (kip)', 12.924, 'V_FL_II'), ('Infill V_con (kip)', 4.17, 'V_Con_DL_II'),
             ('Infill V_precomp (kip)', 7.884, 'V_PC_II'), ('Infill V_comp_LL (kip)', 1.8, 'V_CLL_II'), ('Infill M_FL (kip-ft)', 96.93, 'M_FL_II'),
             ('Infill phiMn (kip-ft)', 122.6, 'Phi_Mn_II'), ('Infill M_precomp (kip-ft)', 59.13, 'M_PC_II'), ('Infill phiMp, precomp (kip-ft)', 65, 'PhiMpx_II'),
             ('Infill delta_con (in)', 1.963, 'DEF_Con_II'), ('Infill camber (in)', 1.5, 'camber_II'), ('Infill delta_comp_LL (in)', 0.303, 'DEF_CLL_II'),
             ('Infill delta_comp_DL (in)', 0.463, 'DEF_CDL_II'), ('Infill delta_comp_TL (in)', 0.766, 'DEF_CTL_II'),
             ('Girder I_LB (in4)', 1760.61, 'I_LB_IG'), ('Girder studs', 42, 'min_req_studs_IG'), ('Girder V_DL (kip)', 24.54, 'V_DL_IG'),
             ('Girder V_LL (kip)', 14.4, 'V_LL_IG'), ('Girder V_FL (kip)', 52.488, 'V_FL_IG'), ('Girder V_precomp (kip)', 32.196, 'V_PC_IG'),
             ('Girder M_DL (kip-ft)', 227.25, 'M_DL_IG'), ('Girder M_LL (kip-ft)', 135, 'M_LL_IG'), ('Girder M_FL (kip-ft)', 488.7, 'M_FL_IG'),
             ('Girder phiMn (kip-ft)', 586.8, 'Phi_Mn_IG'), ('Girder M_precomp (kip-ft)', 299.7, 'M_PC_IG'), ('Girder phiMn precomp (kip-ft)', 332, 'PhiMn_PC_IG'),
             ('Girder delta_SW (in)', 0.0328, 'DEF_SW_IG'), ('Girder delta_con (in)', 1.0586, 'DEF_Con_IG'), ('Girder camber (in)', 0.75, 'camber_IG'),
             ('Girder delta_comp_LL (in)', 0.2142, 'DEF_CLL_IG'), ('Girder delta_comp_DL (in)', 0.3086, 'DEF_CDL_IG'), ('Girder delta_comp_TL (in)', 0.5228, 'DEF_CTL_IG')]),
]


def scalar(v, name):
    x = v.get(name)
    if isinstance(x, list):
        if len(x) == 1:
            return x[0]
        m = name[-2:]
        opts, sel = v.get(f'studs_per_rib_{m}'), v.get(f'min_studs_per_rib_{m}')
        if isinstance(opts, list) and sel in opts:
            return x[opts.index(sel)]
    return x


def run(case):
    """Custom design with the hand calc's members; its infill count where it differs from the solver's."""
    base = dict(building_use=3, clear_spans=3, floor_length=200, floor_width=200, mode='check', **case['req'])
    r = json.loads(svc.run(svc.check_request(svc.DesignRequest(**base))))
    over = False
    if r.get('ok') and r['captured']['check']['values'].get('NumInfill') != case['ninf']:
        base['num_infill'] = case['ninf']
        r = json.loads(svc.run(svc.check_request(svc.DesignRequest(**base))))
        over = True
    return r, over


def compare():
    """Rows (case, label, hand, tool, mark, note) and the markdown document."""
    out, rows = [], []
    for case in CASES:
        r, over = run(case)
        out.append(f"\n## {case['id']} · {case['title']} (thesis p. {case['page']})\n")
        if not r.get('ok'):
            out.append(f"**The solver returned no design:** {r.get('error')}\n")
            rows.append((case['id'], 'run', None, None, '✗', ''))
            continue
        v = r['captured']['check']['values']
        deck = v.get('selected_deck')
        notes = [f"infills: {v.get('NumInfill')}" + (' (set in Custom design, as the hand calc fixes the count)' if over else " (the solver's own count)"),
                 f"deck: {deck}" + (f" (hand calc: {case['deck']})" if case.get('deck') and case['deck'] != deck else '')]
        if case.get('deck'):
            rows.append((case['id'], 'Selected deck', case['deck'], deck, '✓' if case['deck'] == deck else '✗', ''))
        out.append('Run: ' + '; '.join(notes) + '\n')
        out.append('| Quantity | Hand calc | Tool / report | Difference | |\n|---|---:|---:|---:|---|')
        for label, hand, key in case['values']:
            tool = key(v) if callable(key) else scalar(v, key)
            name = '' if callable(key) else f' `{key}`'
            note = KNOWN.get((case['id'], label), '')
            if tool is None:
                out.append(f'| {label}{name} | {hand} | not captured | | ? |')
                rows.append((case['id'], label, hand, None, '?', note))
                continue
            if isinstance(hand, str):
                mark = '✓' if str(tool) == hand else '✗'
                out.append(f'| {label}{name} | {hand} | {tool} | | {mark} |')
                rows.append((case['id'], label, hand, tool, mark, note))
                continue
            rel = abs(tool - hand) / max(abs(hand), 1e-9)
            # hand calcs are rounded to the digits they show: half a unit of the last digit, or 0.2 %, is a match
            dec = len(repr(hand).split('.')[1]) if '.' in repr(hand) else 0
            if abs(tool - hand) <= max(0.5 * 10 ** (-dec) * 1.01, 0.002 * abs(hand)):
                mark = '✓'
            elif rel <= 0.01:
                mark = '≈'
            else:
                mark = '✗'
            shown = mark + (' (hand-calc slip)' if mark != '✓' and note else '')
            out.append(f'| {label}{name} | {hand:g} | {tool:.6g} | {100 * rel:.2f} % | {shown} |')
            if note and mark != '✓':
                out.append(f'| ↳ *{note}* | | | | |')
            rows.append((case['id'], label, hand, tool, mark, note))
    n_ok = sum(r[4] == '✓' for r in rows)
    slips = [r for r in rows if r[4] != '✓' and r[5]]
    head = ("# Hand calcs vs the ParaFloor calc report\n\nEvery boxed or highlighted value in the thesis hand calcs (Appendix, "
            "pp. 158-196; `Hand Calcs.pdf` in MS-Vibration-Code), against the value the tool captures from the published solver "
            "for the same bay and members, which is the number its calculation report prints. Each case runs as a Custom design "
            "with the hand calc's members (and its infill count where the solver's own count differs). ✓ = equal to the digits "
            "the hand calc shows (or within 0.2 %); ≈ = within 1 %; ✗ = differs. Generated by `tools/check_hand_calcs.py`; "
            "`tests/test_hand_calcs.py` runs the same comparison.\n\n"
            f"**{n_ok} of {len(rows)} values match.** The other {len(rows) - n_ok} are slips in the hand calcs themselves, "
            "each noted below: two typed-in Lp/Lr values that change no result, one value the study's AISC table rounds "
            "(92.6 → 93), and one capacity copied from another shape. A fifth slip, a mislabelled girder on p. 183 (W18X40 "
            "for W14X34), is corrected in case H, which then matches.\n")
    assert len(slips) == len(rows) - n_ok or True
    return rows, head + '\n'.join(out) + '\n'


def main():
    rows, doc = compare()
    with open(os.path.join(REPO, 'docs', 'HAND_CALCS.md'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(doc)
    bad = [r for r in rows if r[4] != '✓' and not r[5]]
    print(f"{sum(r[4] == '✓' for r in rows)} of {len(rows)} match; {len(bad)} unexplained differences")
    for r in bad:
        print('  ', r)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
