# Prints a clean results table from the .out files themselves, one row per element and gas.
# Only counts a result if all three runs finished AND match the current input files.
# Usage: python3 show_results.py

import os
import glob
import filecmp
from ase.data import atomic_numbers                     # gives the atomic number of each element, for sorting

RY_TO_EV = 13.605693                                    # 1 Ry in eV
GASES = ['CO2', 'SO2', 'CO']                                  # the gases to report

def check(folder, name):                                # returns (energy, problem) for one run
    inp, out, done = f'{folder}/{name}.in', f'{folder}/{name}.out', f'{folder}/{name}.in.done'
    if not os.path.exists(out):
        return None, f'{name} not run yet'
    if not os.path.exists(done) or not filecmp.cmp(inp, done, shallow=False):
        return None, f'{name} old or unfinished'        # the .out does not belong to the current settings
    lines = [l for l in open(out) if l.startswith('!')]   # QE marks the final energy line with "!"
    if not lines:
        return None, f'{name} has no final energy'
    return float(lines[-1].split()[4]), ''              # 5th word on that line is the energy in Ry

rows = []
for folder in glob.glob('runs/*'):
    el = os.path.basename(folder)
    if el not in atomic_numbers:                        # skips the gas folders
        continue
    for gas in GASES:
        if not os.path.exists(f'{folder}/gas_folder_{gas}.txt'):
            continue                                    # this gas has not been set up for this element yet
        gas_dir = open(f'{folder}/gas_folder_{gas}.txt').read().strip()
        E_sys, p1 = check(folder, f'{el}_{gas}_system')
        E_surf, p2 = check(folder, f'{el}_surface')
        E_gas, p3 = check(gas_dir, f'{gas}_gas')
        problems = ', '.join(p for p in (p1, p2, p3) if p)
        ecut = gas_dir.split('ecut')[-1]                # the cutoff is in the gas folder name
        if problems:
            rows.append((gas, atomic_numbers[el], el, None, ecut, problems))
        else:
            rows.append((gas, atomic_numbers[el], el, (E_sys, E_surf, E_gas), ecut, 'done'))

rows.sort()                                             # grouped by gas, then by atomic number
with open('results_clean.csv', 'w') as f:               # a clean CSV, rewritten every time
    f.write('gas,Z,element,E_system_Ry,E_surface_Ry,E_gas_Ry,E_ads_Ry,E_ads_eV,cutoff_Ry,status\n')
    shown = None
    for gas, z, el, e, ecut, status in rows:
        if gas != shown:                                # a heading for each gas
            print(f"\n{gas}")
            print(f"{'Z':>3} {'El':<3} {'E_system Ry':>15} {'E_surface Ry':>15} {'E_gas Ry':>13} {'E_ads Ry':>10} {'E_ads eV':>9} {'cutoff':>6}  status")
            shown = gas
        if e:
            E_sys, E_surf, E_gas = e
            E_ads = E_sys - (E_surf + E_gas)
            print(f"{z:>3} {el:<3} {E_sys:>15.6f} {E_surf:>15.6f} {E_gas:>13.6f} {E_ads:>10.6f} {E_ads * RY_TO_EV:>9.3f} {ecut:>6}  {status}")
            f.write(f'{gas},{z},{el},{E_sys:.6f},{E_surf:.6f},{E_gas:.6f},{E_ads:.6f},{E_ads * RY_TO_EV:.3f},{ecut},{status}\n')
        else:
            print(f"{z:>3} {el:<3} {'':>15} {'':>15} {'':>13} {'':>10} {'':>9} {ecut:>6}  {status}")
            f.write(f'{gas},{z},{el},,,,,,{ecut},{status}\n')
print("\nsaved results_clean.csv")
