// structures.js: turns the real simulation input files into atom positions the 3D viewer can draw.
// Nothing here is invented: the atoms shown are the atoms that were used in the calculation.

import { ELEMENTS, GASES } from './data.js'; // metal names and gas facts

let inputsPromise = null; // the big input file module is loaded once, the first time a structure is needed

function loadInputs() { // loads js/inputs.js on demand so the first page view stays light
  if (!inputsPromise) inputsPromise = import('./inputs.js'); // start loading only once
  return inputsPromise; // everyone waits for the same load
}

export function parseGeometry(text) { // reads the cell and the atoms out of a Quantum ESPRESSO input file
  const cellMatch = text.match(/CELL_PARAMETERS angstrom\s*\n([^\n]+)\n([^\n]+)\n([^\n]+)/); // the three cell vectors
  const cell = cellMatch ? [1, 2, 3].map((i) => cellMatch[i].trim().split(/\s+/).map(Number)) : null; // each vector as three numbers
  const block = text.split('ATOMIC_POSITIONS')[1] || ''; // everything after the atoms heading
  const atoms = []; // the atoms found, in file order
  for (const line of block.split('\n').slice(1)) { // skip the heading line itself
    const m = line.trim().match(/^([A-Z][a-z]?)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/); // symbol followed by x, y and z
    if (!m) { if (atoms.length) break; else continue; } // stop at the first non atom line after the list began
    atoms.push({ el: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) }); // store the atom
  }
  return { cell, atoms }; // the geometry
}

export async function getSlab(sym) { // the bare metal surface for one metal
  const { SURFACE_INPUTS } = await loadInputs(); // the generated input files
  const text = SURFACE_INPUTS[sym]; // the input for this metal
  if (!text) return null; // no surface model for this metal
  const g = parseGeometry(text); // read the atoms
  const zs = g.atoms.map((a) => a.z); // heights of all atoms
  const top = Math.max(...zs); // height of the highest layer
  g.topIndexes = g.atoms.map((a, i) => (a.z > top - 0.3 ? i : -1)).filter((i) => i >= 0); // atoms in the top layer, the ones a gas can land on
  g.topZ = top; // remember the height of the top layer
  return g; // the surface geometry
}

export async function getGas(gas) { // the lone gas molecule, centred for display
  const { GAS_INPUTS } = await loadInputs(); // the generated input files
  const key = Object.keys(GAS_INPUTS).find((k) => k.startsWith(`${gas}|`)); // any cutoff version has the same shape
  const g = parseGeometry(GAS_INPUTS[key]); // read the atoms
  const c = g.atoms.reduce((a, t) => ({ x: a.x + t.x / g.atoms.length, y: a.y + t.y / g.atoms.length, z: a.z + t.z / g.atoms.length }), { x: 0, y: 0, z: 0 }); // centre of the molecule
  g.atoms = g.atoms.map((a) => ({ el: a.el, x: a.x - c.x, y: a.y - c.y, z: a.z - c.z })); // move the centre to the origin
  g.bonds = bondsOf(g.atoms); // the lines between bonded atoms
  return g; // the molecule geometry
}

export function bondsOf(atoms) { // finds bonded pairs, anything closer than 1.8 angstrom
  const out = []; // pairs of atom numbers
  for (let i = 0; i < atoms.length; i++) { // each atom
    for (let j = i + 1; j < atoms.length; j++) { // each later atom
      const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z); // distance between them
      if (d < 1.8) out.push([i, j]); // close enough to count as a bond
    }
  }
  return out; // the list of bonds
}

export async function getSystem(sym, gas, siteIndex) { // the surface with the gas above one chosen top atom
  const slab = await getSlab(sym); // the surface
  const { SYSTEM_INPUTS } = await loadInputs(); // the generated input files
  const full = parseGeometry(SYSTEM_INPUTS[`${sym}|${gas}`]); // the atoms as used in the real calculation
  const gasAtoms = full.atoms.slice(slab.atoms.length); // the atoms after the surface atoms are the gas
  const anchor = gasAtoms[0]; // the gas atom nearest the surface, the first one listed
  const site = slab.atoms[slab.topIndexes.includes(siteIndex) ? siteIndex : slab.topIndexes[0]]; // the chosen top atom
  const dx = site.x - anchor.x; // shift sideways so the gas sits over the chosen atom
  const dy = site.y - anchor.y; // shift along the other sideways direction
  const moved = gasAtoms.map((a) => ({ el: a.el, x: a.x + dx, y: a.y + dy, z: a.z })); // the gas, moved but at the same height
  const height = anchor.z - slab.topZ; // the height of the gas above the top layer, 2.5 angstrom in our runs
  return { cell: slab.cell, slab, gas: moved, bonds: bondsOf(moved), height, site, label: ELEMENTS[sym].name + ' with ' + GASES[gas].name }; // everything the viewer needs
}
