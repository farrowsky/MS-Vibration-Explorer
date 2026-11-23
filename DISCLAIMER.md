# Disclaimer

ParaFloor is a **research showcase**. It exists to communicate and reproduce the study
*Carbon-Efficient Design Strategies for Mitigating Footfall Vibration in Steel Framed Floor Systems*
(S. D. Farrow, N. C. Brown and R. L. Solnosky) and the code published with it.

**It is not a design tool.** Nothing it produces (results, figures, 3D models, calculation reports or downloaded data)
is a structural design, a code check, a specification, or professional engineering advice.

1. **Do not use the output to design, check, approve or modify any real structure.** Floor design requires a licensed
   professional engineer who applies the governing building code, current standards and the project's actual conditions.
2. **The model is the study's model.** It covers one interior bay with identical neighbours, with uniform loads from the
   solver's occupancy table. Deck and topping come from a study table. Members are chosen only from the AISC W-shapes the
   study allowed, with the study's selection rules. Vibration uses the AISC Design Guide 11 walking-excitation procedure
   as implemented in the study, and embodied carbon uses the factors in Table 3 of the paper. Connections, columns,
   diaphragm action, fire resistance, constructability, ponding, construction tolerances, rhythmic or sensitive-equipment
   vibration criteria, and many other real conditions are not considered.
3. **Data sources.** Steel shape properties and deck values are the study's modified versions of the AISC *Steel
   Construction Manual* (16th ed.) and manufacturer/SDI tables. They may differ from the current official publications.
   References to AISC, SDI or any manufacturer describe data the study used and do not imply endorsement.
4. **Inputs outside the study** (spans outside 10–50 ft, occupancies other than residential, composite levels other than
   25 / 50 / 75 %, other deck continuity) run the same solver, but the paper makes no claims about them and they have not
   been reviewed.
5. **Visual effects are illustrations.** The vibrating floor, footfall ripples, walking test and the spatial colour maps
   are built from the solver's AISC Design Guide 11 quantities (mode shape from the beam and girder deflections, peak
   acceleration at mid-bay). DG 11 itself reports one peak acceleration at mid-bay.
6. **No warranty, no liability.** The software and its output are provided "as is", without warranty of any kind,
   express or implied, under the MIT License. In no event shall the authors, The Pennsylvania State University or any
   contributor be liable for any claim, damages or other liability arising from the use of this tool or its output.
