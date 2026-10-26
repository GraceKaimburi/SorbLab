# STEP 1, BUILD (ASE)
# Builds the crystal surface of one element, the lone gas molecule, and the gas sitting on the surface.
# Checks the geometry, then writes a Quantum ESPRESSO input file for each.
# Usage: python3 step1_build.py Na SO2      (the gas is CO2 if you leave it out)

import sys                                              # reads the element and gas you type after the script
import os                                               # makes folders and file paths
import glob                                             # finds the pseudopotential file automatically
import copy                                             # makes independent copies of the settings
import math                                             # for rounding numbers up
import numpy as np                                      # for working with lists of atom positions
from ase.build import bcc110, fcc111, hcp0001, diamond111, surface, molecule, add_adsorbate  # surface builders and gas tools
from ase.spacegroup import crystal                      # builds any crystal from its symmetry
from ase.neighborlist import neighbor_list              # counts each atom's bonds, used in the safety checks
from ase.io import write                                # saves structures so you can view them in CrystalMaker
from ase.io.espresso import write_espresso_in           # writes QE input files
import warnings                                         # lets us hide one harmless ASE message
warnings.filterwarnings("ignore", message="Skipping unhashable")  # ASE complains it cannot save placement info to .xyz, it does not matter

# The gases. 'down' is the atom that points at the surface.
GASES = {
    'CO2': 'O',                                         # CO2 is straight, one oxygen end points down
    'SO2': 'S',                                         # SO2 is bent like a V, the sulfur points down
    'CO': 'C',                                          # CO is straight, the carbon end points down
}
ALL_GAS_ELEMENTS = ['C', 'O', 'S']                      # every element in any gas, used so the cutoff never depends on the gas

# Simple crystals: shape and real lattice constants in A.
CRYSTALS = {
    'Li': ('bcc', 3.51, None),                          # BCC needs only a
    'Be': ('hcp', 2.29, 3.58),                          # HCP needs a and c
    'B':  ('alpha-B', 4.908, 12.567),                   # rhombohedral alpha-boron, a and c of its hexagonal cell
    'Na': ('bcc', 4.23, None),
    'Mg': ('hcp', 3.21, 5.21),
    'Al': ('fcc', 4.05, None),                          # FCC needs only a
    'Si': ('diamond', 5.431, None),                     # diamond cubic, like a diamond gem, needs only a
    'K':  ('bcc', 5.23, None),
    'Ca': ('fcc', 5.58, None),
    'Sc': ('hcp', 3.309, 5.273),
    'Ti': ('hcp', 2.951, 4.686),
    'V':  ('bcc', 3.03, None),
    'Rb': ('bcc', 5.585, None),
    'Sr': ('fcc', 6.084, None),
    'Ga': ('symmetry', None, None),                     # orthorhombic, built from its symmetry, see SYMMETRY_CRYSTALS
    'In': ('symmetry', None, None),                     # tetragonal, built from its symmetry
    'Sn': ('symmetry', None, None),                     # tetragonal (beta tin, the form stable at room temperature)
}

# Crystals with no ready-made ASE builder. Each is built from its symmetry group and one atom position,
# then cut along the face that breaks the fewest bonds per area (worked out beforehand).
SYMMETRY_CRYSTALS = {
    'Ga': dict(spacegroup=64,                           # Cmce, alpha-gallium: atoms come in tightly bonded pairs
               basis=(0, 0.1549, 0.0810),
               cellpar=[4.5197, 7.6633, 4.5260, 90, 90, 90],   # three different sides, all angles 90 degrees
               atoms=8, bond=(2.40, 2.55),             # 8 atoms per box, shortest bond (the pair) about 2.48 A
               face=(1, 0, 0), layers=3, repeat=(1, 1, 1)),  # (100) never splits a Ga2 pair; 24 atoms
    'In': dict(spacegroup=139,                          # I4/mmm, indium: like FCC but stretched along one axis
               basis=(0, 0, 0),
               cellpar=[3.2523, 3.2523, 4.9461, 90, 90, 90],
               atoms=2, bond=(3.20, 3.40),             # 2 atoms per box, shortest bond about 3.25 A
               face=(1, 0, 1), layers=4, repeat=(1, 2, 1)),  # (101) is indium's version of the close packed FCC face; 16 atoms
    'Sn': dict(spacegroup=141,                          # I4_1/amd, beta tin
               basis=(0, 0, 0),
               cellpar=[5.8318, 5.8318, 3.1819, 90, 90, 90],
               atoms=4, bond=(2.95, 3.10),             # 4 atoms per box, shortest bond about 3.02 A
               face=(1, 0, 0), layers=2, repeat=(1, 2, 1)),  # (100) breaks the fewest bonds; 16 atoms
}

K_DENSITY = 30          # k-points times cell length in A, kept the same for every slab so sampling is equally careful
RHO_FACTOR = 8          # ecutrho is this many times ecutwfc, the usual choice for PAW pseudopotentials

SETTINGS = {                                            # shared by every run; the cutoffs are filled in below
    'control': {
        'calculation': 'scf',                           # energy once, atoms held still
        'pseudo_dir': os.path.abspath('pseudo'),        # full path, because QE runs inside each element's folder
        'tprnfor': True,                                # print forces, a sanity check
    },
    'system': {
        'occupations': 'smearing',                      # metals need smearing to converge
        'smearing': 'mv',                               # Marzari-Vanderbilt, good for metals
        'degauss': 0.02,                                # smearing width in Ry
    },
    'electrons': {
        'conv_thr': 1.0e-6,                             # how tight before the calc stops
        'mixing_beta': 0.3,                             # small steady steps, avoids bouncing
    },
}

def find_pseudo(el):                                    # finds pseudo/Na.something.UPF, no more guessing filenames
    files = glob.glob(f'pseudo/{el}.*UPF') + glob.glob(f'pseudo/{el}.*upf')  # the dot stops C from matching Ca
    if len(files) != 1:
        sys.exit(f"STOP: expected one pseudopotential for {el} in pseudo/, found {files}")
    return files[0]

def suggested_cutoff(path):                             # reads the cutoff the pseudopotential's author recommends
    for line in open(path, errors='ignore'):
        if 'Suggested minimum cutoff for wavefunctions' in line:
            return float(line.split(':')[1].split()[0])  # the number after the colon, in Ry
    print(f"no suggested cutoff in {path}, using 50 Ry")  # older files may not say; 50 is a safe middle value
    return 50.0

def build_alpha_boron(a, c):                            # alpha-boron: no ready-made ASE builder, so we build it from its symmetry
    bulk = crystal(['B', 'B'],                          # two distinct boron positions, ASE copies them using the symmetry
                   basis=[(0.11886, -0.11886, 0.89133),  # boron site 1 (Decker and Kasper, 1959)
                          (0.19686, -0.19686, 0.02432)], # boron site 2
                   spacegroup=166,                      # R-3m, the symmetry group of alpha-boron
                   cellpar=[a, a, c, 90, 90, 120])      # hexagonal cell: sides a, a, c and angles in degrees
    d = bulk.get_all_distances(mic=True)                # every B to B distance
    np.fill_diagonal(d, 99)                             # ignore each atom's distance to itself
    if len(bulk) != 36 or not 1.60 < d.min() < 1.75:    # real alpha-boron has 36 atoms here and shortest bond about 1.67 A
        sys.exit(f"STOP: boron crystal looks wrong, {len(bulk)} atoms, shortest bond {d.min():.2f} A")
    bulk.positions[:, 2] += 0.2 * c                     # shift up so no 12-atom cluster is cut in half by the cell edge
    bulk.wrap()                                         # fold atoms back into the cell after the shift
    bulk.pbc = [True, True, False]                      # repeat sideways only, not up and down
    bulk.center(vacuum=7.5, axis=2)                     # 7.5 A of empty space above and below, same as the metals
    return bulk                                         # a slab of three whole layers of boron clusters

def build_diamond(el, a):                               # diamond cubic (Si, Ge): each atom has 4 bonds, like carbon in a diamond gem
    slab = diamond111(el, size=(2, 2, 10), a=a, vacuum=7.5)          # the (111) face, the natural cleavage plane, 10 atomic layers
    z = slab.positions[:, 2].round(2)                   # height of every atom
    keep = (z > z.min()) & (z < z.max())                # ASE ends each side on a lone layer with 3 broken bonds per atom
    slab = slab[keep]                                   # remove those two layers so each surface atom has only 1 broken bond, like real Si(111)
    slab.center(vacuum=7.5, axis=2)                     # put back 7.5 A of vacuum above and below
    d = slab.get_all_distances(mic=True)                # check the result
    np.fill_diagonal(d, 99)
    bonds = (d < 1.2 * d.min()).sum(1)                  # number of bonds for each atom
    if bonds.min() < 3:                                 # every atom should have 4 bonds inside or 3 at the surface
        sys.exit(f"STOP: {el} diamond slab has atoms with only {bonds.min()} bonds, termination is wrong")
    return slab                                         # 8 atomic layers, that is 4 double layers

def build_from_symmetry(el):                            # for Ga, In, Sn: build the crystal from its symmetry, then cut the chosen face
    s = SYMMETRY_CRYSTALS[el]
    bulk = crystal([el], basis=[s['basis']], spacegroup=s['spacegroup'], cellpar=s['cellpar'])
    shortest = neighbor_list('d', bulk, 4.0).min()      # shortest bond in the crystal, including bonds to the next box over
    low, high = s['bond']
    if len(bulk) != s['atoms'] or not low < shortest < high:   # compare with the known crystal
        sys.exit(f"STOP: {el} crystal looks wrong, {len(bulk)} atoms, shortest bond {shortest:.2f} A")
    slab = surface(bulk, s['face'], s['layers'], vacuum=7.5)   # cut the chosen face, with 7.5 A of vacuum above and below
    slab = slab.repeat(s['repeat'])                     # make it wider sideways where needed, so the gas has room
    bonds = np.bincount(neighbor_list('i', slab, 1.15 * shortest), minlength=len(slab))  # bonds per atom
    if bonds.min() < 2:                                 # an atom hanging on by fewer than 2 bonds means a bad cut
        sys.exit(f"STOP: {el} slab has an atom with only {bonds.min()} bonds, the cut is wrong")
    if el == 'Ga':                                      # extra check for gallium: every atom must keep its pair partner
        d = slab.get_all_distances(mic=True)
        np.fill_diagonal(d, 99)
        if (d.min(1) > 2.6).any():
            sys.exit("STOP: the gallium cut broke a Ga2 pair")
    return slab

def build_surface(el):                                  # picks the right builder from the crystal shape
    shape, a, c = CRYSTALS[el]
    if shape == 'bcc':
        return bcc110(el, size=(2, 2, 4), a=a, vacuum=7.5)          # most tightly packed BCC face
    if shape == 'fcc':
        return fcc111(el, size=(2, 2, 4), a=a, vacuum=7.5)          # most tightly packed FCC face
    if shape == 'hcp':
        return hcp0001(el, size=(2, 2, 4), a=a, c=c, vacuum=7.5)    # most tightly packed HCP face
    if shape == 'diamond':
        return build_diamond(el, a)
    if shape == 'alpha-B':
        return build_alpha_boron(a, c)
    if shape == 'symmetry':
        return build_from_symmetry(el)
    sys.exit(f"STOP: no builder for shape {shape}")

def gas_molecule(gas):                                  # the gas molecule, turned so the 'down' atom is lowest
    m = molecule(gas)                                   # ASE knows the shape and bond lengths of CO2 and SO2
    if gas == 'SO2':
        m.rotate(180, 'x')                              # ASE draws SO2 with sulfur on top; flip it so sulfur points down
    if gas == 'CO' and m.get_chemical_symbols()[m.positions[:, 2].argmin()] != 'C':
        m.rotate(180, 'x')                              # flip CO so the carbon is the lowest atom
    return m

def slab_kpoints(atoms):                                # same sampling density for every slab, whatever its size
    lengths = np.linalg.norm(atoms.cell[:2], axis=1)    # the two sideways cell lengths in A
    return (math.ceil(K_DENSITY / lengths[0]), math.ceil(K_DENSITY / lengths[1]), 1)  # 1 up and down, it is vacuum

def write_input(folder, name, atoms, pseudos, kpts, ecut):  # writes one QE .in file
    s = copy.deepcopy(SETTINGS)                         # fresh copy so jobs never share edits
    s['control']['prefix'] = name                       # each job gets its own scratch name, no clashes
    s['system']['ecutwfc'] = ecut                       # wavefunction cutoff in Ry
    s['system']['ecutrho'] = RHO_FACTOR * ecut          # density cutoff in Ry
    with open(f'{folder}/{name}.in', 'w') as f:
        write_espresso_in(f, atoms, input_data=s, pseudopotentials=pseudos, kpts=kpts)
    print(f"wrote {folder}/{name}.in ({len(atoms)} atoms, k-points {kpts})")

el = sys.argv[1]                                        # the element you asked for
gas = sys.argv[2] if len(sys.argv) > 2 else 'CO2'       # the gas you asked for, CO2 if none given
if el not in CRYSTALS:
    sys.exit(f"STOP: {el} is not in CRYSTALS yet, add its shape and lattice constants first")
if gas not in GASES:
    sys.exit(f"STOP: {gas} is not in GASES, choose one of {list(GASES)}")

paths = {x: find_pseudo(x) for x in [el] + ALL_GAS_ELEMENTS}   # the pseudopotential files this element and the gases need
pseudos = {x: os.path.basename(p) for x, p in paths.items()}

# One cutoff per element, high enough for the element and every gas atom, so CO2 and SO2 share the same clean surface
needed = max(suggested_cutoff(p) for p in paths.values())
ecut = 5 * math.ceil(needed / 5)                        # round up to the next multiple of 5 Ry
print(f"{el} with {gas}: cutoff {ecut} Ry (highest recommended among {el} and the gas atoms was {needed} Ry)")

# Part A, the crystal surface (the same file for every gas)
slab = build_surface(el)
folder = f'runs/{el}'
os.makedirs(folder, exist_ok=True)                      # one folder per element keeps things tidy
write(f'{folder}/{el}_surface.xyz', slab)

# Part B, place the gas above the topmost surface atom, its 'down' atom lowest
system = slab.copy()
top = slab.positions[:, 2].argmax()                     # the highest surface atom
ads = gas_molecule(gas)
bottom = ads.positions[:, 2].argmin()                   # the lowest gas atom
if ads.get_chemical_symbols()[bottom] != GASES[gas]:    # make sure the right atom points down
    sys.exit(f"STOP: expected {GASES[gas]} to point down, got {ads.get_chemical_symbols()[bottom]}")
add_adsorbate(system, ads, height=2.5, position=tuple(slab.positions[top, :2]), mol_index=bottom)  # directly above it
write(f'{folder}/{el}_{gas}_system.xyz', system)

# Part C, the safety check
gas_i = list(range(len(slab), len(system)))             # the gas atoms are the ones added after the slab
metal_i = list(range(len(slab)))                        # the surface atoms
closest = min(system.get_distance(g, m, mic=True) for g in gas_i for m in metal_i)
print(f"closest gas to surface distance {closest:.2f} A")
if abs(closest - 2.5) > 0.2:
    sys.exit("STOP: gas is not placed correctly, no input files written")

# Part D, write the inputs
kpts = slab_kpoints(slab)
write_input(folder, f'{el}_surface', slab, pseudos, kpts, ecut)
write_input(folder, f'{el}_{gas}_system', system, pseudos, kpts, ecut)  # same grid and cutoff so they compare fairly

gas_folder = f'runs/{gas}_gas_ecut{ecut}'               # one gas run per gas and cutoff, shared by every element using it
os.makedirs(gas_folder, exist_ok=True)
lone = gas_molecule(gas)
box = 12 if gas == 'SO2' else 15   # SO2 gas box is smaller, 840 Ry in 15 A needs over 22 GB
lone.set_cell([box, box, box])                             # big empty box so it is truly alone
lone.center()
write_input(gas_folder, f'{gas}_gas', lone, pseudos, (1, 1, 1), ecut)
open(f'{folder}/gas_folder_{gas}.txt', 'w').write(gas_folder)   # tells steps 2 and 3 which gas run belongs to this element
