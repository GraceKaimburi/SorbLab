// data.js: every fixed number and label the tool uses, kept in one place so the rest of the code never repeats them.
// The binding energies come from our own Quantum ESPRESSO calculations (PBE, PAW pseudopotentials, no dispersion correction).

export const EV_TO_KJ_PER_MOL = 96.485; // converts electronvolts to kilojoules per mole, the unit most experiments report
export const RY_TO_EV = 13.605693; // converts Rydberg (the unit Quantum ESPRESSO prints) to electronvolts

export const GASES = { // the three gases we calculated, with plain names for the interface
  CO2: { formula: 'CO2', label: 'CO₂', name: 'carbon dioxide', down: 'O', note: 'the main greenhouse gas from fuel burning' }, // CO2 lands with one oxygen end down
  CO: { formula: 'CO', label: 'CO', name: 'carbon monoxide', down: 'C', note: 'a toxic gas from incomplete burning' }, // CO lands with its carbon end down
  SO2: { formula: 'SO2', label: 'SO₂', name: 'sulfur dioxide', down: 'S', note: 'the acid rain gas from smelters and coal plants' }, // SO2 is bent and lands with sulfur down
};

export const ELEMENTS = { // the twelve metals with finished calculations
  Li: { name: 'lithium', family: 'alkali metal', crystal: 'body centred cubic', face: '(110)', chi: 0.98, radius: 152, cutoff: 105, pseudo: 'Li.pbe-s-kjpaw_psl.1.0.0.UPF' }, // chi is electronegativity, radius is metallic radius in picometres
  Na: { name: 'sodium', family: 'alkali metal', crystal: 'body centred cubic', face: '(110)', chi: 0.93, radius: 186, cutoff: 70, pseudo: 'Na.pbe-spn-kjpaw_psl.1.0.0.UPF' }, // cutoff is the plane wave cutoff in Rydberg used for its runs
  K: { name: 'potassium', family: 'alkali metal', crystal: 'body centred cubic', face: '(110)', chi: 0.82, radius: 227, cutoff: 50, pseudo: 'K.pbe-spn-kjpaw_psl.1.0.0.UPF' }, // pseudo is the pseudopotential file the inputs refer to
  Rb: { name: 'rubidium', family: 'alkali metal', crystal: 'body centred cubic', face: '(110)', chi: 0.82, radius: 248, cutoff: 50, pseudo: 'Rb.pbe-spn-kjpaw_psl.1.0.0.UPF' }, // the largest atom in the set
  Be: { name: 'beryllium', family: 'alkaline earth metal', crystal: 'hexagonal close packed', face: '(0001)', chi: 1.57, radius: 112, cutoff: 50, pseudo: 'Be.pbe-n-kjpaw_psl.1.0.0.UPF' }, // the smallest atom in the set
  Mg: { name: 'magnesium', family: 'alkaline earth metal', crystal: 'hexagonal close packed', face: '(0001)', chi: 1.31, radius: 160, cutoff: 60, pseudo: 'Mg.pbe-spnl-kjpaw_psl.1.0.0.UPF' }, // needs a higher cutoff than Be because of its extra semicore electrons
  Ca: { name: 'calcium', family: 'alkaline earth metal', crystal: 'face centred cubic', face: '(111)', chi: 1.00, radius: 197, cutoff: 50, pseudo: 'Ca.pbe-spn-kjpaw_psl.1.0.0.UPF' }, // calcium binds all three gases most strongly in our set
  Sr: { name: 'strontium', family: 'alkaline earth metal', crystal: 'face centred cubic', face: '(111)', chi: 0.95, radius: 215, cutoff: 50, pseudo: 'Sr.pbe-spn-kjpaw_psl.1.0.0.UPF' }, // chemically similar to calcium, one row down
  Al: { name: 'aluminium', family: 'post transition metal', crystal: 'face centred cubic', face: '(111)', chi: 1.61, radius: 143, cutoff: 50, pseudo: 'Al.pbe-n-kjpaw_psl.1.0.0.UPF' }, // the metal in the porous material NOTT-300
  Ga: { name: 'gallium', family: 'post transition metal', crystal: 'orthorhombic (alpha gallium)', face: '(100)', chi: 1.81, radius: 135, cutoff: 60, pseudo: 'Ga.pbe-dn-kjpaw_psl.1.0.0.UPF' }, // atoms sit in tightly bonded pairs
  In: { name: 'indium', family: 'post transition metal', crystal: 'body centred tetragonal', face: '(101)', chi: 1.78, radius: 167, cutoff: 50, pseudo: 'In.pbe-dn-kjpaw_psl.1.0.0.UPF' }, // a stretched version of face centred cubic
  Sn: { name: 'tin', family: 'post transition metal', crystal: 'body centred tetragonal (beta tin)', face: '(100)', chi: 1.96, radius: 140, cutoff: 50, pseudo: 'Sn.pbe-dn-kjpaw_psl.1.0.0.UPF' }, // the form of tin that is stable at room temperature
};

export const RESULTS = { // adsorption energy in eV for each metal and gas, negative means the gas binds
  Li: { CO2: -0.054, CO: -0.359, SO2: -0.648 }, // lithium
  Na: { CO2: -0.054, CO: -0.191, SO2: -0.415 }, // sodium
  K: { CO2: -0.012, CO: 0.046, SO2: -0.202 }, // potassium
  Rb: { CO2: 0.112, CO: 0.323, SO2: 0.157 }, // rubidium
  Be: { CO2: 0.251, CO: 0.144, SO2: 0.332 }, // beryllium
  Mg: { CO2: 0.087, CO: -0.200, SO2: -0.102 }, // magnesium
  Ca: { CO2: -0.097, CO: -0.536, SO2: -0.753 }, // calcium
  Sr: { CO2: -0.049, CO: -0.365, SO2: -0.527 }, // strontium
  Al: { CO2: 0.213, CO: -0.159, SO2: -0.050 }, // aluminium
  Ga: { CO2: 0.271, CO: 0.080, SO2: 1.270 }, // gallium, the SO2 value is far above the others and is still being checked
  In: { CO2: 0.347, CO: 0.138, SO2: 0.385 }, // indium
  Sn: { CO2: 0.441, CO: 0.222, SO2: 0.554 }, // tin
};

export const FLAGS = { // values that should be shown with a warning
  'Ga|SO2': 'This value is much larger than every other result and is still being checked for a geometry or convergence problem.', // the gallium and SO2 outlier
};

export const CANDIDATES = { // elements with no calculation yet, so only a model estimate can be given
  Cs: { name: 'caesium', family: 'alkali metal', chi: 0.79, radius: 265 }, // heavier cousin of rubidium
  Ba: { name: 'barium', family: 'alkaline earth metal', chi: 0.89, radius: 222 }, // heavier cousin of strontium
  Zn: { name: 'zinc', family: 'transition metal', chi: 1.65, radius: 134 }, // common in smelting ores
  Cd: { name: 'cadmium', family: 'transition metal', chi: 1.69, radius: 151 }, // zinc's heavier cousin
  Tl: { name: 'thallium', family: 'post transition metal', chi: 1.62, radius: 170 }, // sits below indium
};

export const REFERENCE = { // measured numbers for a real porous material, used only for scale
  material: 'NOTT-300', // an aluminium metal organic framework made in 2012
  co2KjPerMol: [27, 30], // measured heat of CO2 adsorption range in kJ per mole
  source: 'Yang et al., Nature Chemistry 4, 887 (2012)', // where the measurement was published
};

export const SETTINGS = { // the calculation settings shared by every run, shown on the results page
  code: 'Quantum ESPRESSO (pw.x)', // the simulation program
  method: 'PBE with PAW pseudopotentials, no dispersion correction', // the physics approximation
  slab: 'metal surface slab with 7.5 Å of empty space above and below', // how the surface is modelled
  height: 'gas placed 2.5 Å above the top atom, atoms not relaxed', // a fixed height, not an optimised one
  kDensity: 30, // k points times cell length in angstroms
  smearing: 'Marzari Vanderbilt, width 0.02 Ry', // how electron occupations are spread near the Fermi level
};
