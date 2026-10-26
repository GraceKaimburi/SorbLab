// app.js: connects the page to the engine. It reads the question, calls the language model service if it is available,
// falls back to the built in reader if not, and draws the answer. All calculations live in engine.js.

import { GASES, ELEMENTS, CANDIDATES, SETTINGS, REFERENCE } from './data.js'; // the fixed data
import { parseLocal, answer, explainLocal, ranking, buildBundle, fmt, toKj } from './engine.js'; // the logic
import { barChart } from './chart.js'; // the bar chart drawing
import { makeZip } from './zip.js'; // builds a zip of the input files
import { ICONS } from './icons.js'; // the line icons
import { initTheme } from './theme.js'; // the light and dark switch
import { Viewer, slabScene, systemScene, gasScene } from './viewer.js'; // the 3D atom viewer and its scene builders
import { getSlab, getGas, getSystem } from './structures.js'; // real atom positions read from the input files

const $ = (id) => document.getElementById(id); // short helper to find an element by its id
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); // makes any text safe to put inside HTML
const label = (g) => GASES[g].label; // the display form of a gas, such as SO₂
let current = null; // the answer currently on screen, used by the file viewer and the tooltip
let bundle = null; // the input files for the current answer

const EXAMPLES = [ // clickable example questions
  'How strongly does SO2 stick to calcium?', // a single metal and gas
  'Which metal binds carbon dioxide best?', // a ranking
  'Compare Mg and Al for CO', // a comparison
  'What about gallium and sulfur dioxide?', // a flagged value
  'Estimate CO2 on caesium', // a model only estimate
];

async function callApi(body) { // sends a request to the language model service, returns null on any problem
  try { // any network failure must not break the page
    const ctl = new AbortController(); // lets us give up after a while
    const timer = setTimeout(() => ctl.abort(), 15000); // stop waiting after 15 seconds
    const resp = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }); // send the request
    clearTimeout(timer); // the request finished in time
    if (!resp.ok) return null; // treat server errors as unavailable
    const data = await resp.json(); // read the reply
    return data.fallback ? null : data; // the service says fallback when it has no key or hit an error
  } catch (e) { // network error or timeout
    return null; // use the built in reader instead
  }
}

function cleanRequest(r, raw) { // checks a request returned by the language model so nothing unsupported gets through
  if (!r || typeof r !== 'object') return null; // must be an object
  const elements = (r.elements || []).filter((s) => ELEMENTS[s]); // keep only supported metals
  const candidates = (r.candidates || []).filter((s) => CANDIDATES[s]); // keep only estimate only metals
  const gases = (r.gases || []).filter((g) => GASES[g]); // keep only supported gases
  const intents = ['single', 'element', 'compare', 'rank', 'estimate', 'help']; // the allowed request types
  const intent = intents.includes(r.intent) ? r.intent : null; // reject anything else
  if (!intent) return null; // no valid intent means we cannot trust the reply
  return { intent, elements, candidates, gases, unsupported: [], raw }; // the cleaned request in the same shape as the built in reader
}

function facts(res) { // a small summary of the answer sent to the language model for explanation, it contains all the numbers it may use
  if (res.kind === 'single') return { kind: 'single', metal: ELEMENTS[res.sym].name, gas: GASES[res.gas].name, energy_eV: Number(res.value.toFixed(3)), kJ_per_mol: Number(res.kj.toFixed(1)), rank: res.rank, of: res.of, label: res.strength.label, model_estimate_eV: Number(res.est.value.toFixed(3)), model_typical_error_eV: Number(res.est.error.toFixed(2)), model_useful: res.est.useful, warning: res.flag, reference: { material: REFERENCE.material, kJ_per_mol_low: REFERENCE.co2KjPerMol[0], kJ_per_mol_high: REFERENCE.co2KjPerMol[1] } }; // everything for one metal and gas
  if (res.kind === 'rank') return { kind: 'rank', gas: GASES[res.gas].name, order: res.rows.map((r) => ({ metal: ELEMENTS[r.symbol].name, energy_eV: r.value })) }; // the whole ranking
  if (res.kind === 'element') return { kind: 'element', metal: ELEMENTS[res.sym].name, rows: res.rows.map((r) => ({ gas: GASES[r.gas].name, energy_eV: r.value, rank: r.rank })) }; // one metal, three gases
  if (res.kind === 'compare') return { kind: 'compare', gases: res.gases.map((g) => GASES[g].name), rows: res.rows.map((r) => ({ metal: ELEMENTS[r.sym].name, energies_eV: r.values })) }; // a comparison table
  if (res.kind === 'estimate') return { kind: 'estimate', metal: CANDIDATES[res.sym].name, gas: GASES[res.gas].name, model_estimate_eV: Number(res.est.value.toFixed(3)), model_typical_error_eV: Number(res.est.error.toFixed(2)), outside_training_range: res.est.outside }; // an estimate only answer
  return { kind: 'help' }; // nothing to explain
}

function understood(req, source) { // the small table that shows how the question was read
  const rows = []; // lines of the table
  if (req.elements.length) rows.push(['Metal', req.elements.map((s) => `${esc(ELEMENTS[s].name)} (${s})`).join(', ')]); // supported metals found
  if (req.candidates.length) rows.push(['Metal, estimate only', req.candidates.map((s) => `${esc(CANDIDATES[s].name)} (${s})`).join(', ')]); // estimate only metals found
  if (req.gases.length) rows.push(['Gas', req.gases.map((g) => `${esc(GASES[g].name)} (${label(g)})`).join(', ')]); // gases found
  rows.push([source === 'steps' ? 'Chosen with' : 'Question read by', source === 'model' ? 'language model' : source === 'steps' ? 'the step by step picker' : 'built in reader']); // which reader was used, shown so users know how much to rely on it
  return `<table class="kv"><tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`).join('')}</tbody></table>`; // a two column table
}

function resultCard(res) { // the main number and its plain meaning
  if (res.kind === 'single') { // one metal and one gas
    const e = ELEMENTS[res.sym]; // facts about the metal
    return `<div class="figure"><div class="fig-value ${res.strength.tone}">${fmt(res.value)}<span class="unit"> eV</span></div><div class="fig-meta"><div class="fig-label">Adsorption energy, ${esc(e.name)} and ${esc(GASES[res.gas].name)}</div><div class="badge ${res.strength.tone}">${res.strength.label}</div><div class="fig-sub">${fmt(res.kj, 1)} kJ per mol. Rank ${res.rank} of ${res.of} metals for this gas.</div><div class="fig-sub">Source: calculated (DFT)</div></div></div>${res.flag ? `<p class="callout warn">${ICONS.warn}<span>${esc(res.flag)}</span></p>` : ''}`; // headline figure with its label and badge
  }
  if (res.kind === 'estimate') { // a model only number
    const warn = res.est.outside.length ? `<p class="callout warn">${ICONS.warn}<span>This metal lies outside the range of the calculated metals, so the number is a rough guess.</span></p>` : ''; // extrapolation warning
    return `<div class="figure"><div class="fig-value neutral">${fmt(res.est.value)}<span class="unit"> eV</span></div><div class="fig-meta"><div class="fig-label">Estimate, ${esc(CANDIDATES[res.sym].name)} and ${esc(GASES[res.gas].name)}</div><div class="badge neutral">Model estimate, not calculated</div><div class="fig-sub">Typical error of this model for ${label(res.gas)}: about ${res.est.error.toFixed(2)} eV.</div></div></div>${warn}<p class="callout info">${ICONS.info}<span>No simulation inputs are offered for this metal because it has no validated surface model yet.</span></p>`; // the estimate with its warnings
  }
  if (res.kind === 'element') { // one metal, all three gases
    return `<table class="data"><thead><tr><th>Gas</th><th class="num">Energy (eV)</th><th>Result</th><th class="num">Rank of 12</th></tr></thead><tbody>${res.rows.map((r) => `<tr><td>${esc(GASES[r.gas].name)}</td><td class="num">${fmt(r.value)}</td><td><span class="badge ${r.strength.tone}">${r.strength.label}</span></td><td class="num">${r.rank}</td></tr>`).join('')}</tbody></table>`; // one row per gas
  }
  if (res.kind === 'compare') { // several metals side by side
    return `<table class="data"><thead><tr><th>Metal</th>${res.gases.map((g) => `<th class="num">${label(g)} (eV)</th>`).join('')}</tr></thead><tbody>${res.rows.map((r) => `<tr><td>${esc(ELEMENTS[r.sym].name)} (${r.sym})</td>${r.values.map((v) => `<td class="num">${fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; // one row per metal
  }
  if (res.kind === 'rank') { // ranking of all metals for one gas
    return `<table class="data"><thead><tr><th class="num">Rank</th><th>Metal</th><th class="num">Energy (eV)</th><th>Result</th></tr></thead><tbody>${res.rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(ELEMENTS[r.symbol].name)} (${r.symbol})</td><td class="num">${fmt(r.value)}</td><td><span class="badge ${r.value < 0 ? 'bind' : 'repel'}">${r.value < 0 ? 'Binds' : 'Does not bind'}</span></td></tr>`).join('')}</tbody></table>`; // one row per metal in order
  }
  return `<p>I could not match a metal and a gas in that question. The twelve metals are lithium, sodium, potassium, rubidium, beryllium, magnesium, calcium, strontium, aluminium, gallium, indium and tin. The three gases are CO₂, CO and SO₂.${res.unsupported && res.unsupported.length ? ` There are no results yet for ${esc(res.unsupported.join(', '))}.` : ''}</p><p>See the <a href="help.html">help page</a> for example questions.</p>`; // guidance for questions that did not match
}

function chartBlock(res) { // the chart and its legend for answers that have one
  let rows = null, sel = null, gas = null; // what to draw
  if (res.kind === 'single') { rows = ranking(res.gas); sel = res.sym; gas = res.gas; } // one metal highlighted among all twelve
  if (res.kind === 'rank') { rows = res.rows; gas = res.gas; } // no highlight for a ranking
  if (!rows) return ''; // other answers have no chart
  const table = `<details class="tableview"><summary>View as table</summary><table class="data"><thead><tr><th class="num">Rank</th><th>Metal</th><th class="num">Energy (eV)</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(ELEMENTS[r.symbol].name)} (${r.symbol})</td><td class="num">${fmt(r.value)}</td></tr>`).join('')}</tbody></table></details>`; // the same numbers as text, for accessibility and exact reading
  return `<section class="panel"><h2>Comparison with the other metals</h2><p class="muted">Adsorption energy of ${esc(GASES[gas].name)} on each metal, strongest binding first.</p><ul class="legend"><li><span class="swatch bind"></span>Binds (negative)</li><li><span class="swatch repel"></span>Does not bind (positive)</li></ul><div class="chart">${barChart(rows, sel, label(gas))}</div>${table}</section>`; // the whole chart panel
}

function notesBlock(res) { // the plain list of caveats that go with every calculated number
  if (!['single', 'rank', 'compare', 'element'].includes(res.kind)) return ''; // other answers carry their own notes
  const items = [ // what a careful reader should know
    `Method: ${SETTINGS.method}.`, // the approximation used
    `Geometry: ${SETTINGS.height}. The numbers are therefore not fully relaxed binding energies.`, // the fixed height limitation
    `Model: ${SETTINGS.slab}.`, // how the surface was modelled
    'These are clean metal surfaces. Real metals in industry are usually covered by an oxide layer, which changes the binding.', // a real world limit
  ];
  return `<section class="panel"><h2>Notes on these numbers</h2><ul class="plain">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`; // the notes panel
}

async function inputsBlock(res) { // the panel with the simulation input files
  if (res.kind !== 'single') return ''; // inputs exist only for one metal and one gas
  const pseudo = $('pseudodir') ? $('pseudodir').value : './pseudo'; // the user's chosen folder, if the field already exists
  bundle = await buildBundle(res.sym, res.gas, pseudo || './pseudo'); // build the three files and the script
  const tabs = bundle.files.map((f, i) => `<button type="button" class="tab${i === 0 ? ' on' : ''}" data-i="${i}" role="tab">${esc(f.role)}</button>`).join(''); // one tab per file
  return `<section class="panel" id="inputs"><h2>Simulation inputs</h2><p class="muted">Three Quantum ESPRESSO calculations give one adsorption energy: the surface with the gas, the surface alone, and the gas alone. These are the exact files used for the numbers above.</p><div class="field"><label for="pseudodir">Folder holding your pseudopotential files</label><input id="pseudodir" type="text" value="${esc(pseudo || './pseudo')}" spellcheck="false"></div><div class="tabs" role="tablist">${tabs}</div><div class="fileinfo" id="fileinfo"></div><pre class="code" id="filebody" tabindex="0"></pre><div class="actions"><button type="button" class="btn" id="copy">${ICONS.copy}<span>Copy file</span></button><button type="button" class="btn" id="dl-file">${ICONS.download}<span>Download file</span></button><button type="button" class="btn primary" id="dl-all">${ICONS.download}<span>Download all as zip</span></button></div><h3>How to run them</h3><ol class="steps"><li>Put the pseudopotential files named in each input into the folder above.</li><li>Unzip the download and run <code>bash run_sorblab.sh</code> in that folder. It runs the three calculations one after another on 4 processes.</li><li>The last line printed is the adsorption energy in eV. Compare it with the number on this page.</li></ol></section>`; // the whole inputs panel
}

function showFile(i) { // puts one input file into the viewer
  const f = bundle.files[i]; // the chosen file
  document.querySelectorAll('#inputs .tab').forEach((t, k) => t.classList.toggle('on', k === i)); // highlight the active tab
  $('filebody').textContent = f.content; // show the text safely, without treating it as HTML
  $('filebody').dataset.i = i; // remember which file is showing
  const n = f.info; // readable settings of the file
  $('fileinfo').textContent = `${f.name}: ${n.atoms} atoms, plane wave cutoff ${n.ecutwfc} Ry, k point grid ${n.kpoints ? n.kpoints.join(' x ') : 'n/a'}`; // a one line summary above the file
}

function download(name, content, type = 'text/plain') { // saves text as a file on the user's computer
  const blob = content instanceof Blob ? content : new Blob([content], { type }); // wrap text in a Blob unless it already is one
  const url = URL.createObjectURL(blob); // a temporary address for the file
  const a = document.createElement('a'); // an invisible link
  a.href = url; a.download = name; // point it at the file and give the saved name
  document.body.appendChild(a); a.click(); a.remove(); // click it once and clean up
  setTimeout(() => URL.revokeObjectURL(url), 2000); // free the memory after the download starts
}

function wireInputs() { // attaches the buttons of the inputs panel
  if (!$('inputs')) return; // nothing to do when there is no inputs panel
  document.querySelectorAll('#inputs .tab').forEach((t) => t.addEventListener('click', () => showFile(Number(t.dataset.i)))); // switch file on tab click
  showFile(0); // start with the first file
  $('copy').addEventListener('click', async () => { // copy button
    const text = bundle.files[Number($('filebody').dataset.i)].content; // the file on screen
    try { await navigator.clipboard.writeText(text); flash($('copy'), 'Copied'); } catch (e) { flash($('copy'), 'Press Ctrl and C'); } // clipboard may be blocked, so say so politely
  });
  $('dl-file').addEventListener('click', () => { const f = bundle.files[Number($('filebody').dataset.i)]; download(f.name, f.content); }); // download the file on screen
  $('dl-all').addEventListener('click', () => download(`${current.sym}_${current.gas}_inputs.zip`, makeZip([...bundle.files.map((f) => ({ name: f.name, content: f.content })), { name: 'run_sorblab.sh', content: bundle.script }]))); // download everything
  $('pseudodir').addEventListener('change', async () => { // rebuild the files when the folder changes
    bundle = await buildBundle(current.sym, current.gas, $('pseudodir').value.trim() || './pseudo'); // new files with the new path
    showFile(Number($('filebody').dataset.i || 0)); // show the same tab again
  });
}

function flash(btn, text) { // briefly changes a button label to confirm an action
  const span = btn.querySelector('span'); // the text part of the button
  const old = span.textContent; // remember the original label
  span.textContent = text; // show the confirmation
  setTimeout(() => { span.textContent = old; }, 1400); // restore after a moment
}

function wireTooltip() { // shows the value of a bar when the pointer or keyboard is on it
  const tip = $('tip'); // the floating box
  document.querySelectorAll('.chart .row').forEach((row) => { // each bar row
    const show = (ev) => { // fills and places the box
      const v = Number(row.dataset.val); // the energy of this row
      tip.innerHTML = `<strong>${esc(ELEMENTS[row.dataset.sym].name)}</strong><br>${fmt(v)} eV (${fmt(toKj(v), 1)} kJ per mol)`; // the text of the box
      tip.hidden = false; // make it visible
      const r = ev.type === 'focus' ? row.getBoundingClientRect() : { left: ev.clientX, top: ev.clientY, bottom: ev.clientY }; // anchor to the pointer or to the focused row
      tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + 12)}px`; // keep it on screen horizontally
      tip.style.top = `${r.bottom + 12 + window.scrollY - (ev.type === 'focus' ? 0 : 0)}px`; // just below the anchor
    };
    row.addEventListener('mousemove', show); row.addEventListener('focus', show); // show while moving or focused
    row.addEventListener('mouseleave', () => { tip.hidden = true; }); row.addEventListener('blur', () => { tip.hidden = true; }); // hide when leaving
  });
}

function setStatus(text) { $('status').textContent = text; } // writes the progress line inside step four

async function ask(question) { // the typed question path, from words to an answer on screen
  const q = question.trim(); // remove stray spaces
  if (!q) return; // ignore empty questions
  $('s4').classList.remove('locked'); // make sure step four is visible
  setStatus('Working on it...'); // tell the user something is happening
  $('ask-btn').disabled = true; // prevent double submits
  const parsed = await callApi({ task: 'parse', question: q }); // try the language model reader first
  let req = parsed ? cleanRequest(parsed.request, q) : null; // validate what it returned
  const source = req ? 'model' : 'local'; // remember which reader produced the request
  if (!req) req = parseLocal(q); // fall back to the built in reader
  await run(req, q, source, true); // show the answer and keep the steps in sync
  $('ask-btn').disabled = false; // allow another question
  saveRecent(q); // remember the question
}

async function run(req, q, source, sync) { // turns a structured request into everything on screen
  if (sync) await syncFlow(req); // make the steps above show the same metal and gas
  const res = answer(req); // look up and compute the answer
  current = res; // remember it for the viewer
  const out = $('output'); // where the answer goes
  const explained = res.kind === 'help' ? null : await callApi({ task: 'explain', facts: facts(res) }); // ask the language model for a plain explanation
  const text = explained && explained.text ? explained.text : explainLocal(res); // use the built in explanation if there is none
  const inputs = await inputsBlock(res); // build the inputs panel if this answer has one
  const head = source === 'steps' ? `<section class="panel"><h2>Your choices</h2>${understood(req, source)}</section>` : `<section class="panel"><h2>Your question</h2><p class="quote">${esc(q)}</p>${understood(req, source)}</section>`; // choices for the picker, the question for typed input
  out.innerHTML = `${head}<section class="panel"><h2>Result</h2>${resultCard(res)}</section>${res.kind === 'help' ? '' : `<section class="panel"><h2>What this means</h2><p>${esc(text)}</p></section>`}${chartBlock(res)}${inputs}${notesBlock(res)}`; // draw every panel in order
  out.hidden = false; // reveal the output area
  $('s4').classList.remove('locked'); $('s4').classList.add('done'); // step four is available and finished
  setStatus(''); // clear the status line
  await drawSystem(); // show the 3D picture of the calculation when there is one
  wireInputs(); wireTooltip(); // attach the buttons and the tooltip
  $('s4').scrollIntoView({ behavior: 'smooth', block: 'start' }); // bring the answer into view
}

// ---- the step by step picker: periodic table, surface viewer and gas cards ----

const sel = { sym: null, gas: null, site: -1, slab: null }; // what the visitor has chosen so far
let vSlab = null, vSys = null; // the two big viewers
const vGas = {}; // the small molecule viewers, one per gas
const PT_ROWS = { 2: ['Li', 'Be', null, null, null], 3: ['Na', 'Mg', null, 'Al', null], 4: ['K', 'Ca', 'Zn', 'Ga', null], 5: ['Rb', 'Sr', 'Cd', 'In', 'Sn'], 6: ['Cs', 'Ba', null, 'Tl', null] }; // element positions by period, columns are groups 1, 2, 12, 13 and 14
const PT_HEAD = ['1', '2', '12', '13', '14']; // the group numbers over the columns

function tileInfo(sym) { return ELEMENTS[sym] || CANDIDATES[sym]; } // facts about a tile's element from either list

function buildTable() { // draws the mini periodic table
  let html = '<span></span>' + PT_HEAD.map((g) => `<span class="hd">Group ${g}</span>`).join(''); // the header row
  for (const [period, row] of Object.entries(PT_ROWS)) { // each period
    html += `<span class="rl">Period ${period}</span>`; // the row label
    for (const sym of row) { // each column
      if (!sym) { html += '<span></span>'; continue; } // an empty cell where no element is shown
      const info = tileInfo(sym); // its facts
      const calc = Boolean(ELEMENTS[sym]); // true when a calculation exists
      html += `<button type="button" class="tile${calc ? '' : ' est'}" data-sym="${sym}" aria-pressed="false" title="${esc(info.name)}, ${esc(info.family)}${calc ? '' : ', estimate only'}"><b>${sym}</b><small>${esc(info.name)}</small></button>`; // one tile
    }
  }
  $('ptable').innerHTML = html; // put the table on the page
  $('ptable').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) pickMetal(t.dataset.sym); }); // choose a metal when a tile is clicked
}

function layerCount(slab) { return new Set(slab.atoms.map((a) => a.z.toFixed(1))).size; } // the number of distinct heights, which is the number of layers

async function pickMetal(sym, quiet) { // the visitor chose a metal, by tile or by typing
  sel.sym = sym; sel.site = -1; sel.slab = null; // reset the dependent choices
  document.querySelectorAll('.tile').forEach((t) => { const on = t.dataset.sym === sym; t.classList.toggle('on', on); t.setAttribute('aria-pressed', String(on)); }); // mark the chosen tile
  const info = tileInfo(sym); // facts about the metal
  $('s1').classList.add('done'); // step one is finished
  $('s1-sum').textContent = `Selected: ${info.name} (${sym}), ${info.family}.`; // say what was chosen
  $('s2').classList.remove('locked'); $('s3').classList.remove('locked'); // steps two and three open up
  document.querySelectorAll('.gcard').forEach((c) => { c.disabled = false; }); // the gas cards can now be clicked
  if (ELEMENTS[sym]) { // a metal with a calculated surface
    const slab = await getSlab(sym); // read the real atoms
    sel.slab = slab; sel.site = slab.topIndexes[0]; // start with the first top atom chosen
    $('s2-body').hidden = false; // show the viewer
    vSlab.setScene(slabScene(slab, sel.site)); vSlab.setView('angle'); // draw the surface at a friendly angle
    $('slab-info').textContent = `${info.name} ${info.crystal}, ${info.face} surface: ${slab.atoms.length} atoms in ${layerCount(slab)} layers. The dashed box is the simulation cell and the faded atoms are its repeats.`; // describe what is shown
    $('s2-sum').textContent = 'This is the surface the gas will land on, exactly as used in the calculation.'; // a line under the title
    $('s2').classList.add('done'); // step two is finished
  } else { // an estimate only metal
    $('s2-body').hidden = true; // nothing to show
    $('s2-sum').textContent = `There is no surface model for ${info.name} yet, so only a model estimate is possible.`; // explain why
    $('s2').classList.add('done'); // nothing more to do here
  }
  $('s3-sum').textContent = 'Pick the gas that should land on the surface. Drag a molecule to turn it.'; // a line under the title
  if (!quiet) { if (sel.gas) await pickGas(sel.gas); else $('s2').scrollIntoView({ behavior: 'smooth', block: 'start' }); } // rerun with the new metal, or move down to the surface
}

async function pickSite(id) { // the visitor clicked a top atom
  if (id < 0 || !sel.slab) return; // ignore clicks that did not hit a top atom
  sel.site = id; // remember it
  vSlab.setScene(slabScene(sel.slab, id)); // move the highlight
  if (current && current.kind === 'single') await drawSystem(); // move the gas in the result picture too
}

async function pickGas(g) { // the visitor chose a gas, by card or by typing
  sel.gas = g; // remember it
  document.querySelectorAll('.gcard').forEach((c) => c.classList.toggle('on', c.dataset.gas === g)); // mark the chosen card
  $('s3').classList.add('done'); // step three is finished
  $('s3-sum').textContent = `Selected: ${GASES[g].name} (${label(g)}).`; // say what was chosen
  if (!sel.sym) return; // wait for a metal
  const calc = Boolean(ELEMENTS[sel.sym]); // does a calculation exist
  const req = { intent: calc ? 'single' : 'estimate', elements: calc ? [sel.sym] : [], candidates: calc ? [] : [sel.sym], gases: [g], unsupported: [], raw: '' }; // the same shape the typed path produces
  $('s4').classList.remove('locked'); setStatus('Working on it...'); // open step four with a message
  await run(req, '', 'steps', false); // show the answer
}

async function syncFlow(req) { // makes the steps match a typed question
  const sym = req.elements.length === 1 ? req.elements[0] : req.candidates.length === 1 && !req.elements.length ? req.candidates[0] : null; // the single metal asked about, if any
  if (sym && sym !== sel.sym) await pickMetal(sym, true); // show it in steps one and two
  if (req.gases.length === 1) { // the single gas asked about, if any
    sel.gas = req.gases[0]; // remember it
    document.querySelectorAll('.gcard').forEach((c) => c.classList.toggle('on', c.dataset.gas === sel.gas)); // mark the card
    $('s3').classList.add('done'); $('s3-sum').textContent = `Selected: ${GASES[sel.gas].name} (${label(sel.gas)}).`; // finish step three
  }
}

async function drawSystem() { // draws the surface with the gas above it for single answers
  const box = $('sysview'); // the result picture area
  if (!current || current.kind !== 'single') { box.hidden = true; return; } // other answers have no picture
  box.hidden = false; // show the area
  const site = sel.slab && sel.sym === current.sym ? sel.site : -1; // the chosen top atom, or the first one by default
  const sys = await getSystem(current.sym, current.gas, site); // build the real system
  vSys.setScene(systemScene(sys)); vSys.setView('angle'); // draw it at a friendly angle
  $('sys-info').textContent = `${GASES[current.gas].name} placed ${sys.height.toFixed(1)} Å above a top ${ELEMENTS[current.sym].name} atom, as in the calculation. The atoms were not relaxed. Red is oxygen, grey is carbon and yellow is sulfur.`; // say what the picture shows
}

async function buildGasCards() { // draws the three gas cards with spinning molecules
  $('gascards').innerHTML = Object.keys(GASES).map((g) => `<button type="button" class="gcard" data-gas="${g}" disabled><canvas aria-hidden="true"></canvas><b>${esc(GASES[g].name)} (${label(g)})</b><span>${esc(GASES[g].note)}. Lands with its ${GASES[g].down} end down.</span></button>`).join(''); // one card per gas, locked until a metal is chosen
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // some people ask for no moving pictures
  for (const g of Object.keys(GASES)) { // each gas
    const cv = document.querySelector(`.gcard[data-gas="${g}"] canvas`); // its drawing surface
    vGas[g] = new Viewer(cv, { yaw: 0.9, pitch: 0.5, fit: 0.9 }); // a small viewer
    vGas[g].setScene(gasScene(await getGas(g))); // draw the real molecule
    if (!calm) vGas[g].setSpin(true); // turn slowly unless motion is unwanted
  }
  $('gascards').addEventListener('click', (e) => { const c = e.target.closest('.gcard'); if (c && !c.disabled) pickGas(c.dataset.gas); }); // choose a gas when a card is clicked
}

function wireViewerTools() { // makes the Angle, Top, Side, zoom and spin buttons work
  document.addEventListener('click', (e) => { // one listener for every tool button
    const b = e.target.closest('.vtools [data-v]'); // the button that was clicked
    if (!b) return; // not a tool button
    const v = b.closest('.vwrap').querySelector('canvas').id === 'cv-slab' ? vSlab : vSys; // the viewer this toolbar belongs to
    const what = b.dataset.v; // which action
    if (what === 'in') v.zoomBy(1.2); // zoom in
    else if (what === 'out') v.zoomBy(1 / 1.2); // zoom out
    else if (what === 'spin') { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); v.setSpin(on); } // toggle the slow turning
    else v.setView(what); // a preset angle
  });
}

function buildFlow() { // sets up the whole step by step picker
  buildTable(); // the periodic table
  vSlab = new Viewer($('cv-slab'), { onPick: pickSite, fit: 0.82 }); // the surface viewer, clicks choose the landing atom
  vSys = new Viewer($('cv-sys')); // the result viewer
  wireViewerTools(); // the toolbar buttons
  $('s2-next').addEventListener('click', () => $('s3').scrollIntoView({ behavior: 'smooth', block: 'start' })); // the Next button moves down to the gases
  buildGasCards(); // the gas cards, drawn when their data arrives
}

function saveRecent(q) { // keeps the last few questions in this browser only
  try { // storage can be blocked, so never let it break the page
    const list = JSON.parse(localStorage.getItem('sorblab.recent') || '[]').filter((x) => x !== q); // old list without a duplicate
    list.unshift(q); // newest first
    localStorage.setItem('sorblab.recent', JSON.stringify(list.slice(0, 5))); // keep five
    renderRecent(); // refresh the list on screen
  } catch (e) { /* storage unavailable, nothing to do */ } // ignore storage problems
}

function renderRecent() { // shows the recent questions as links
  try { // storage can be blocked
    const list = JSON.parse(localStorage.getItem('sorblab.recent') || '[]'); // read the saved list
    $('recent').innerHTML = list.length ? `<span class="muted">Recent:</span> ${list.map((x) => `<button type="button" class="link" data-q="${esc(x)}">${esc(x)}</button>`).join('')}` : ''; // buttons that rerun a question
  } catch (e) { /* storage unavailable */ } // ignore storage problems
}

function init() { // runs once when the page loads
  initTheme(); // set up the light and dark switch
  buildFlow(); // build the step by step picker
  $('examples').innerHTML = EXAMPLES.map((x) => `<button type="button" class="link" data-q="${esc(x)}">${esc(x)}</button>`).join(''); // example question buttons
  document.addEventListener('click', (e) => { // one listener for every question button
    const b = e.target.closest('[data-q]'); // the button that was clicked
    if (b) { $('question').value = b.dataset.q; ask(b.dataset.q); } // fill the box and ask
  });
  $('ask-form').addEventListener('submit', (e) => { e.preventDefault(); ask($('question').value); }); // ask when the form is submitted
  renderRecent(); // show recent questions
  const q = new URLSearchParams(location.search).get('q'); // a question passed in the address, used by the help page examples
  if (q) { $('question').value = q; ask(q); } // run it straight away
}

init(); // start
