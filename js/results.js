// results.js: draws the results page, the table of every calculated value, the model quality table and the settings list.

import { GASES, ELEMENTS, RESULTS, FLAGS, SETTINGS, REFERENCE } from './data.js'; // the fixed data
import { fmt, toKj, strength, looError, baselineError, toCsv } from './engine.js'; // the shared logic
import { initTheme } from './theme.js'; // the light and dark switch
import { ICONS } from './icons.js'; // the line icons

const $ = (id) => document.getElementById(id); // short helper to find an element by its id
const state = { sort: 'family', unit: 'eV' }; // what the table is currently showing

function cell(sym, gas) { // one table cell holding a value and, where needed, a warning mark
  const v = RESULTS[sym][gas]; // the energy in eV
  const shown = state.unit === 'eV' ? fmt(v) : fmt(toKj(v), 1); // convert if the visitor chose kJ per mole
  const warn = FLAGS[`${sym}|${gas}`] ? ` <span class="warnmark" title="${FLAGS[`${sym}|${gas}`]}">${ICONS.warn}</span>` : ''; // an icon for flagged values, the reason shows on hover
  return `<td class="num">${shown}${warn}</td>`; // the finished cell
}

function drawTable() { // builds the main table from the current choices
  const syms = Object.keys(ELEMENTS); // the twelve metals in their original order
  if (state.sort !== 'family') syms.sort((a, b) => RESULTS[a][state.sort] - RESULTS[b][state.sort]); // sort by a gas, strongest binding first
  $('table-body').innerHTML = syms.map((s) => `<tr><td>${ELEMENTS[s].name}</td><td>${s}</td><td>${ELEMENTS[s].family}</td>${Object.keys(GASES).map((g) => cell(s, g)).join('')}</tr>`).join(''); // one row per metal
  $('unit-head').textContent = state.unit === 'eV' ? 'eV' : 'kJ per mol'; // keep the unit note in step with the choice
}

function drawModel() { // the table that says how good the simple estimate model is
  $('model-body').innerHTML = Object.keys(GASES).map((g) => { // one row per gas
    const m = looError(g); // the model's typical miss in eV
    const b = baselineError(g); // the miss of simply guessing the average
    const good = m < b * 0.75; // the same usefulness rule the assistant uses
    return `<tr><td>${GASES[g].name}</td><td class="num">${m.toFixed(2)}</td><td class="num">${b.toFixed(2)}</td><td>${good ? 'Useful as a rough guide' : 'Not reliable, use calculated values'}</td></tr>`; // the row text
  }).join(''); // join the rows
}

function drawSettings() { // the list of calculation settings
  $('settings').innerHTML = [ // the facts that define every number
    ['Program', SETTINGS.code], // the simulation program
    ['Method', SETTINGS.method], // the physics approximation
    ['Surface', SETTINGS.slab], // how the metal is represented
    ['Gas position', SETTINGS.height], // where the gas is put
    ['k points', `density rule: grid size is ${SETTINGS.kDensity} divided by the cell length in angstrom, rounded up`], // sampling rule
    ['Smearing', SETTINGS.smearing], // how electron occupations are treated
    ['Cutoff', 'one value per metal, the highest recommended by the pseudopotentials of the metal, C, O and S (50 to 105 Ry)'], // the cutoff rule
  ].map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`).join(''); // one row per setting
  $('reference').textContent = `For scale: the measured CO₂ heat of adsorption in the porous material ${REFERENCE.material} is ${REFERENCE.co2KjPerMol[0]} to ${REFERENCE.co2KjPerMol[1]} kJ per mol (${source()}).`; // a sentence giving context
}

function source() { return REFERENCE.source; } // the paper the measured value comes from

function init() { // runs once when the page loads
  initTheme(); // set up the light and dark switch
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; drawTable(); }); // redraw when the sort choice changes
  $('unit').addEventListener('change', (e) => { state.unit = e.target.value; drawTable(); }); // redraw when the unit choice changes
  $('csv').addEventListener('click', () => { // download all values as a file
    const url = URL.createObjectURL(new Blob([toCsv()], { type: 'text/csv' })); // a temporary address for the file
    const a = document.createElement('a'); // an invisible link
    a.href = url; a.download = 'sorblab_results.csv'; // the saved file name
    document.body.appendChild(a); a.click(); a.remove(); // click it once and clean up
    setTimeout(() => URL.revokeObjectURL(url), 2000); // free the memory afterwards
  });
  drawTable(); drawModel(); drawSettings(); // fill every section
}

init(); // start
