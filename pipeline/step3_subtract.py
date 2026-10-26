# STEP 3, SUBTRACT (Python)
# Reads the three energies and computes E_ads = E_system - (E_surface + E_gas).
# Usage: python3 step3_subtract.py Na SO2      (the gas is CO2 if you leave it out)

import sys
import os

RY_TO_EV = 13.605693                                    # 1 Ry in eV

def energy(path):                                       # pulls the final energy out of a QE .out file
    if not os.path.exists(path):
        sys.exit(f"STOP: {path} does not exist, run step 2 first")
    lines = [l for l in open(path) if l.startswith('!')]   # QE marks the final energy line with "!"
    if not lines:
        sys.exit(f"STOP: no final energy in {path}, the run failed or is still going")
    return float(lines[-1].split()[4])                  # 5th word on that line is the energy in Ry

el = sys.argv[1]
gas = sys.argv[2] if len(sys.argv) > 2 else 'CO2'
gas_folder = open(f'runs/{el}/gas_folder_{gas}.txt').read().strip()   # the gas run that shares this element's cutoff
E_sys = energy(f'runs/{el}/{el}_{gas}_system.out')
E_surf = energy(f'runs/{el}/{el}_surface.out')
E_gas = energy(f'{gas_folder}/{gas}_gas.out')
E_ads = E_sys - (E_surf + E_gas)

print(f"{el} with {gas}")
print(f"E_system  {E_sys:.6f} Ry")
print(f"E_surface {E_surf:.6f} Ry")
print(f"E_{gas}     {E_gas:.6f} Ry   (from {gas_folder})")
print(f"E_ads     {E_ads:.6f} Ry   {E_ads * RY_TO_EV:.3f} eV   (negative means the gas sticks)")
