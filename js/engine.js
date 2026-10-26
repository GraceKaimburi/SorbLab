// engine.js: all the logic of the tool with no screen code in it, so it can be tested on its own.
// It reads a question, finds the matching result, estimates missing ones, writes the explanation and builds the input files.

import { EV_TO_KJ_PER_MOL, RY_TO_EV, GASES, ELEMENTS, RESULTS, FLAGS, CANDIDATES, REFERENCE, SETTINGS } from './data.js'; // the fixed numbers and labels

export const MINUS = '−'; // a true minus sign, easier to read than a short hyphen

export function fmt(v, digits = 3) { // formats an energy with an explicit sign
  const s = Math.abs(v).toFixed(digits); // the size of the number with a fixed count of decimals
  return (v < 0 ? MINUS : '+') + s; // negative gets a minus sign, positive gets a plus sign so the direction is never unclear
}

export function toKj(ev) { // converts eV to kJ per mole
  return ev * EV_TO_KJ_PER_MOL; // one multiplication, kept in one function so the factor is used everywhere the same way
}

export function strength(ev) { // turns an energy into a plain word and a tone for the colour of the label
  if (ev <= -0.5) return { label: 'Strong binding', tone: 'bind' }; // clearly more negative than a weak hydrogen bond
  if (ev <= -0.2) return { label: 'Moderate binding', tone: 'bind' }; // comparable to the measured binding in porous materials
  if (ev <= -0.05) return { label: 'Weak binding', tone: 'bind' }; // a small pull, easily undone by heat
  if (ev < 0.05) return { label: 'Close to zero', tone: 'neutral' }; // within the likely error of the method
  return { label: 'Does not bind', tone: 'repel' }; // positive means the gas is better off in the air than on the surface
}

const SYMBOL_ALIASES = { // words people use that should map to the supported gases
  CO2: ['co2', 'carbon dioxide', 'carbondioxide'], // different ways to write CO2 in a sentence
  SO2: ['so2', 'sulfur dioxide', 'sulphur dioxide'], // both spellings of sulfur
  CO: ['carbon monoxide'], // CO the symbol is matched separately because it needs exact capitals
};

const OTHER_METALS = ['copper', 'iron', 'nickel', 'cobalt', 'titanium', 'silver', 'gold', 'platinum', 'palladium', 'lead', 'manganese', 'chromium', 'vanadium', 'zirconium', 'lithium oxide', 'graphene']; // common materials we have no data for, so we can answer politely

export function parseLocal(text) { // a fallback reader of questions that works with no internet or language model
  const raw = String(text || '').slice(0, 500); // cap the length so a huge paste cannot slow the page
  const lower = raw.toLowerCase(); // lower case copy for matching words and names
  const tokens = raw.split(/[^A-Za-z0-9]+/).filter(Boolean); // the words and symbols without punctuation
  const elements = []; // the supported elements found in the question
  const candidates = []; // the estimate only elements found in the question
  for (const sym of Object.keys(ELEMENTS)) { // check each supported metal
    const nameHit = new RegExp(`\\b${ELEMENTS[sym].name}\\b`).test(lower) || (sym === 'Al' && /\baluminum\b/.test(lower)); // match the full name, with the American spelling for aluminium
    const idx = tokens.indexOf(sym); // symbols must match exactly, so Ca is calcium but ca is not
    const risky = (sym === 'In' || sym === 'Be') && idx === 0; // In and Be are ordinary words at the start of a sentence
    if (nameHit || (idx >= 0 && !risky)) elements.push(sym); // keep the metal if either the name or a safe symbol appears
  }
  for (const sym of Object.keys(CANDIDATES)) { // now the elements that only get a model estimate
    if (new RegExp(`\\b${CANDIDATES[sym].name}\\b`).test(lower) || tokens.includes(sym)) candidates.push(sym); // same rule as above
  }
  const gases = []; // the gases found in the question
  for (const g of Object.keys(SYMBOL_ALIASES)) { // check each gas
    if (SYMBOL_ALIASES[g].some((w) => lower.includes(w))) gases.push(g); // any of its written forms counts
  }
  if (tokens.includes('CO') && !gases.includes('CO')) gases.push('CO'); // the symbol CO only counts in capitals, otherwise it matches the word co
  const unsupported = OTHER_METALS.filter((m) => new RegExp(`\\b${m}\\b`).test(lower)); // materials we cannot answer for
  const wantsRank = /\b(best|strongest|most|top|rank|highest|which metal|which element|strongly|weakest|worst)\b/.test(lower) && elements.length === 0; // a question about the whole set
  let intent = 'help'; // default when nothing useful was found
  if (elements.length >= 2) intent = 'compare'; // two or more metals means a side by side comparison
  else if (wantsRank && gases.length >= 1) intent = 'rank'; // no metal named but a gas named, so rank the metals
  else if (elements.length === 1 && gases.length >= 1) intent = 'single'; // one metal and a gas is the main case
  else if (elements.length === 1) intent = 'element'; // a metal with no gas, show all three gases
  else if (candidates.length >= 1) intent = 'estimate'; // only an estimate only element
  else if (gases.length >= 1) intent = 'rank'; // only a gas, so rank the metals for it
  return { intent, elements, candidates, gases, unsupported, raw }; // the structured request used by everything below
}

function solve(A, b) { // solves A x = b by Gaussian elimination, enough for the tiny systems here
  const n = b.length; // the number of unknowns
  const M = A.map((row, i) => [...row, b[i]]); // the augmented matrix, the right hand side added as an extra column
  for (let c = 0; c < n; c++) { // for each column
    let p = c; // find the row with the largest number in this column
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; // pick the largest for numerical safety
    [M[c], M[p]] = [M[p], M[c]]; // swap it into position
    for (let r = c + 1; r < n; r++) { // remove this column from the rows below
      const f = M[r][c] / M[c][c]; // the factor that cancels the entry
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; // subtract the scaled row
    }
  }
  const x = new Array(n).fill(0); // the answer, filled from the bottom up
  for (let i = n - 1; i >= 0; i--) { // back substitution
    let s = M[i][n]; // start with the right hand side
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; // subtract the unknowns already found
    x[i] = s / M[i][i]; // divide by the diagonal to get this unknown
  }
  return x; // the solution vector
}

const FEATURES = ['chi', 'radius']; // the two properties the model uses, electronegativity and atom size
const LAMBDA = 0.1; // ridge strength, a small penalty that stops the fit from chasing noise

function fit(symbols, gas) { // trains the model for one gas on the listed metals
  const X = symbols.map((s) => FEATURES.map((f) => ELEMENTS[s][f])); // the property table
  const y = symbols.map((s) => RESULTS[s][gas]); // the calculated energies to learn from
  const mean = FEATURES.map((_, j) => X.reduce((a, r) => a + r[j], 0) / X.length); // average of each property
  const sd = FEATURES.map((_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - mean[j]) ** 2, 0) / X.length)); // spread of each property
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mean[j]) / sd[j])]); // standardised properties with a leading 1 for the intercept
  const k = Z[0].length; // number of coefficients
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((a, r) => a + r[i] * r[j], 0) + (i === j && i > 0 ? LAMBDA : 0))); // Z transpose times Z plus the penalty, not on the intercept
  const b = Array.from({ length: k }, (_, i) => Z.reduce((a, r, n) => a + r[i] * y[n], 0)); // Z transpose times y
  const w = solve(A, b); // the fitted coefficients
  const lo = FEATURES.map((_, j) => Math.min(...X.map((r) => r[j]))); // smallest property value seen in training
  const hi = FEATURES.map((_, j) => Math.max(...X.map((r) => r[j]))); // largest property value seen in training
  return { w, mean, sd, lo, hi }; // everything needed to predict later
}

function predictWith(model, props) { // uses a trained model on one set of properties
  const z = FEATURES.map((f, j) => (props[f] - model.mean[j]) / model.sd[j]); // standardise the same way as in training
  const value = model.w[0] + z.reduce((a, v, j) => a + v * model.w[j + 1], 0); // intercept plus weighted properties
  const outside = FEATURES.filter((f, j) => props[f] < model.lo[j] || props[f] > model.hi[j]); // properties beyond the training range
  return { value, outside }; // the estimate and the list of properties that went out of range
}

const MODELS = {}; // cache of trained models so each is built once
const LOO = {}; // cache of leave one out errors

function modelFor(gas) { // gets the model for a gas, training it the first time
  if (!MODELS[gas]) MODELS[gas] = fit(Object.keys(ELEMENTS), gas); // train on all twelve metals
  return MODELS[gas]; // return the cached model
}

export function looError(gas) { // average error when each metal is hidden from training and then predicted
  if (LOO[gas] === undefined) { // compute only once
    const all = Object.keys(ELEMENTS); // the twelve metals
    const errs = all.map((s) => Math.abs(predictWith(fit(all.filter((t) => t !== s), gas), ELEMENTS[s]).value - RESULTS[s][gas])); // hide one, predict it, record the miss
    LOO[gas] = errs.reduce((a, v) => a + v, 0) / errs.length; // the mean absolute miss
  }
  return LOO[gas]; // the cached value in eV
}

export function baselineError(gas) { // the error of the laziest guess, the average of the others, to show whether the model adds anything
  const all = Object.keys(ELEMENTS); // the twelve metals
  const errs = all.map((s) => { const others = all.filter((t) => t !== s); return Math.abs(others.reduce((a, t) => a + RESULTS[t][gas], 0) / others.length - RESULTS[s][gas]); }); // guess each as the mean of the rest
  return errs.reduce((a, v) => a + v, 0) / errs.length; // the mean miss of that guess
}

export function estimate(symbol, gas) { // the model estimate for any metal with known properties
  const props = ELEMENTS[symbol] || CANDIDATES[symbol]; // supported metals and estimate only metals both carry the two properties
  const held = ELEMENTS[symbol] ? fit(Object.keys(ELEMENTS).filter((t) => t !== symbol), gas) : modelFor(gas); // for a calculated metal hide it first so the estimate is honest
  const p = predictWith(held, props); // run the model
  const err = looError(gas); // the typical miss of this model
  const useful = err < baselineError(gas) * 0.75; // call it useful only if it clearly beats guessing the average
  return { value: p.value, outside: p.outside, error: err, useful }; // all the parts the screen needs
}

export function ranking(gas) { // all twelve metals ordered from strongest binding to weakest
  return Object.keys(ELEMENTS).map((s) => ({ symbol: s, value: RESULTS[s][gas] })).sort((a, b) => a.value - b.value); // most negative first
}

function scaleSentence(ev, gas) { // puts a number in context against the measured porous material
  const kj = Math.abs(toKj(ev)); // size of the binding in kJ per mole
  const [lo, hi] = REFERENCE.co2KjPerMol; // the measured CO2 range for NOTT-300
  if (ev >= 0.05) return 'A positive value means the gas does not stick at this site.'; // nothing to compare
  const rel = kj < lo ? 'weaker than' : kj > hi ? 'stronger than' : 'similar to'; // compare with the measured range
  return `For scale, ${REFERENCE.material} binds CO₂ at ${lo} to ${hi} kJ per mol; this value is ${rel} that.`; // a reference point for non specialists
}

export function answer(req) { // turns a structured request into a structured result the screen can draw
  const gas = req.gases[0]; // the first gas mentioned, if any
  const sym = req.elements[0]; // the first metal mentioned, if any
  if (req.intent === 'single' && sym && gas) { // the main case, one metal and one gas
    const value = RESULTS[sym][gas]; // the calculated energy
    const rank = ranking(gas).findIndex((r) => r.symbol === sym) + 1; // position among the twelve, 1 is strongest
    return { kind: 'single', sym, gas, value, kj: toKj(value), rank, of: 12, strength: strength(value), est: estimate(sym, gas), flag: FLAGS[`${sym}|${gas}`] || null, scale: scaleSentence(value, gas), canGenerate: true }; // everything needed for the result card
  }
  if (req.intent === 'element' && sym) { // a metal with no gas
    return { kind: 'element', sym, rows: Object.keys(GASES).map((g) => ({ gas: g, value: RESULTS[sym][g], strength: strength(RESULTS[sym][g]), rank: ranking(g).findIndex((r) => r.symbol === sym) + 1 })) }; // one row per gas
  }
  if (req.intent === 'compare' && req.elements.length >= 2) { // two or more metals side by side
    const gases = req.gases.length ? req.gases : Object.keys(GASES); // all gases if none was named
    return { kind: 'compare', elements: req.elements, gases, rows: req.elements.map((s) => ({ sym: s, values: gases.map((g) => RESULTS[s][g]) })) }; // a small table
  }
  if (req.intent === 'rank') { // which metal binds a gas best
    const g = gas || 'CO2'; // CO2 is the default gas
    return { kind: 'rank', gas: g, rows: ranking(g) }; // the ordered list
  }
  if (req.intent === 'estimate' && req.candidates.length) { // an element with no calculation
    const g = gas || 'CO2'; // CO2 is the default gas
    const c = req.candidates[0]; // the first estimate only element
    return { kind: 'estimate', sym: c, gas: g, est: estimate(c, g), canGenerate: false }; // the estimate and a note that no inputs exist
  }
  return { kind: 'help', unsupported: req.unsupported }; // nothing matched, show guidance
}

export function explainLocal(res) { // a plain language explanation built from templates, used when the language model is off
  if (res.kind === 'single') { // explanation for one metal and one gas
    const e = ELEMENTS[res.sym]; // facts about the metal
    const g = GASES[res.gas]; // facts about the gas
    const parts = []; // sentences collected one by one
    parts.push(`${cap(e.name)} gives an adsorption energy of ${fmt(res.value)} eV (${fmt(res.kj, 1)} kJ per mol) for ${g.name}. That is rank ${res.rank} of ${res.of} metals for this gas, where rank 1 binds most strongly.`); // the headline
    if (res.value < 0) parts.push(`A negative number means the gas lowers its energy by sitting on the surface, so it sticks. ${res.strength.label} is how we describe a value of this size.`); // meaning for negative values
    else parts.push('A positive number means the gas has lower energy floating in the air than sitting on the surface, so at this site it would not stay.'); // meaning for positive values
    parts.push(res.scale); // the scale sentence
    if (res.est.useful) parts.push(`A simple model using only electronegativity and atom size, trained on the other metals, estimates ${fmt(res.est.value)} eV, a miss of ${fmt(res.value - res.est.value)} eV; its typical error for ${g.formula} is about ${res.est.error.toFixed(2)} eV.`); // model comparison when the model is useful
    else parts.push(`A simple property model was tried for ${g.formula} but its typical error of about ${res.est.error.toFixed(2)} eV is too large to be useful, so only the calculated value should be trusted.`); // honest note when it is not useful
    if (res.flag) parts.push(`Warning: ${res.flag}`); // pass on the warning
    return parts.join(' '); // one paragraph
  }
  if (res.kind === 'rank') { // explanation of a ranking
    const top = res.rows[0]; // strongest binder
    const last = res.rows[res.rows.length - 1]; // weakest binder
    const n = res.rows.filter((r) => r.value < 0).length; // how many bind at all
    return `For ${GASES[res.gas].name}, ${n} of the 12 metals bind it (negative energy). ${cap(ELEMENTS[top.symbol].name)} binds most strongly at ${fmt(top.value)} eV and ${ELEMENTS[last.symbol].name} binds least at ${fmt(last.value)} eV.`; // short summary
  }
  if (res.kind === 'element') { // explanation of one metal with all gases
    const best = [...res.rows].sort((a, b) => a.value - b.value)[0]; // the gas it holds best
    return `${cap(ELEMENTS[res.sym].name)} holds ${GASES[best.gas].name} best of the three gases, at ${fmt(best.value)} eV.`; // one sentence
  }
  if (res.kind === 'compare') return `The table lists the calculated energy for each metal and gas. More negative means stronger binding; positive means the gas does not stay.`; // explanation of a comparison
  if (res.kind === 'estimate') { // explanation of an estimate only answer
    const e = CANDIDATES[res.sym]; // facts about the element
    const warn = res.est.outside.length ? ' It lies outside the range of the calculated metals, so treat it as a rough guess.' : ''; // extrapolation warning
    return `No calculation exists for ${e.name} yet. A simple model suggests about ${fmt(res.est.value)} eV for ${GASES[res.gas].name}, with a typical error near ${res.est.error.toFixed(2)} eV.${warn} Calculated results for the 12 listed metals are far more reliable.`; // the estimate with caveats
  }
  return 'Try naming one of the twelve metals and one of the three gases, for example: How strongly does SO₂ stick to calcium?'; // guidance for unmatched questions
}

function cap(s) { // capitalises the first letter of a word
  return s.charAt(0).toUpperCase() + s.slice(1); // upper case the first letter and keep the rest
}

export function parseInput(text) { // reads the key settings back out of an input file so the screen can describe it
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; }; // helper that finds one number
  const k = text.match(/K_POINTS automatic\s*\n\s*(\d+)\s+(\d+)\s+(\d+)/); // the k point grid line
  const cell = [...text.matchAll(/CELL_PARAMETERS angstrom\s*\n([^\n]+)\n([^\n]+)\n([^\n]+)/g)][0]; // the three cell vectors
  const lengths = cell ? [1, 2, 3].map((i) => Math.hypot(...cell[i].trim().split(/\s+/).map(Number))) : []; // length of each vector in angstrom
  return { atoms: num(/nat\s*=\s*(\d+)/), ecutwfc: num(/ecutwfc\s*=\s*([\d.]+)/), ecutrho: num(/ecutrho\s*=\s*([\d.]+)/), kpoints: k ? [Number(k[1]), Number(k[2]), Number(k[3])] : null, cell: lengths }; // all the facts in one object
}

export async function buildBundle(sym, gas, pseudoDir = './pseudo') { // collects the three input files and the run script for one metal and gas
  const { SURFACE_INPUTS, SYSTEM_INPUTS, GAS_INPUTS } = await import('./inputs.js'); // load the big file only when needed
  const cutoff = ELEMENTS[sym].cutoff; // the cutoff used for this metal and shared by its gas run
  const swap = (t) => t.replaceAll('@@PSEUDO_DIR@@', pseudoDir); // put the user's pseudopotential folder into the file
  const files = [ // the three simulations needed for one adsorption energy
    { name: `${sym}_surface.in`, role: 'Bare metal surface', content: swap(SURFACE_INPUTS[sym]) }, // energy of the surface alone
    { name: `${sym}_${gas}_system.in`, role: `Surface with ${gas} above it`, content: swap(SYSTEM_INPUTS[`${sym}|${gas}`]) }, // energy of the combined system
    { name: `${gas}_gas_ecut${cutoff}.in`, role: `${gas} molecule alone in a box`, content: swap(GAS_INPUTS[`${gas}|${cutoff}`]) }, // energy of the gas alone
  ];
  files.forEach((f) => { f.info = parseInput(f.content); }); // attach the readable settings to each file
  return { files, script: runScript(sym, gas, files), cutoff }; // the files and the script that runs them
}

export function runScript(sym, gas, files) { // writes a bash script that runs the three jobs and combines the energies
  const [surf, sys, gasf] = files.map((f) => f.name); // the three file names
  const stem = (n) => n.replace('.in', ''); // a file name without its .in ending, which is also its folder name
  const lines = [ // each line of the script, with its own comment for the reader
    '#!/bin/bash', // tells the computer to run this file with bash
    '# Runs the three calculations and combines them into one adsorption energy.', // what the script does
    'set -e   # stop at the first error so a failed run is never used', // safety
    `for f in ${surf} ${sys} ${gasf}; do   # loop over the three input files`, // loop header
    '  d=${f%.in}   # folder name is the file name without .in, so runs never share scratch files', // folder name
    '  mkdir -p "$d" && cp "$f" "$d/"   # make the folder and copy the input into it', // set up the folder
    '  (cd "$d" && mpirun -np 4 pw.x -in "$f" > "${f%.in}.out")   # run Quantum ESPRESSO on 4 processes inside that folder', // run the job
    'done   # all three jobs finished', // end of loop
    `esurf=$(grep '^!' ${stem(surf)}/${stem(surf)}.out | tail -1 | awk '{print $5}')   # total energy of the surface in Rydberg`, // read the surface energy
    `esys=$(grep '^!' ${stem(sys)}/${stem(sys)}.out | tail -1 | awk '{print $5}')   # total energy of surface plus gas`, // read the system energy
    `egas=$(grep '^!' ${stem(gasf)}/${stem(gasf)}.out | tail -1 | awk '{print $5}')   # total energy of the lone gas`, // read the gas energy
    `awk -v a="$esys" -v b="$esurf" -v c="$egas" 'BEGIN{printf "E_ads = %.3f eV\\n", (a-b-c)*${RY_TO_EV}}'   # system minus surface minus gas, converted from Rydberg to eV`, // the adsorption energy formula
  ];
  return lines.join('\n') + '\n'; // join into the script text
}

export function methodNotes() { // short list of the settings behind every number, shown under results
  return [SETTINGS.code, SETTINGS.method, SETTINGS.slab, SETTINGS.height]; // the four facts that matter most when judging a value
}

export function toCsv() { // all 36 results as comma separated text for download
  const rows = ['element,symbol,family,CO2_eV,CO_eV,SO2_eV']; // header row
  for (const s of Object.keys(ELEMENTS)) rows.push([ELEMENTS[s].name, s, ELEMENTS[s].family, RESULTS[s].CO2, RESULTS[s].CO, RESULTS[s].SO2].join(',')); // one row per metal
  return rows.join('\n') + '\n'; // the finished file text
}
