// app.js: connects the page to the engine. It reads the question, calls the language model service if it is available,
// falls back to the built in reader if not, and draws the answer. All calculations live in engine.js.

import { GASES, ELEMENTS, CANDIDATES, SETTINGS, REFERENCE } from './data.js'; // the fixed data
import { parseLocal, answer, explainLocal, ranking, buildBundle, fmt, toKj } from './engine.js'; // the logic
import { barChart } from './chart.js'; // the bar chart drawing
import { makeZip } from './zip.js'; // builds a zip of the input files
import { ICONS } from './icons.js'; // the line icons
import { initTheme } from './theme.js'; // the light and dark switch

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
  rows.push(['Question read by', source === 'model' ? 'language model' : 'built in reader']); // which reader was used, shown so users know how much to rely on it
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

async function ask(question) { // the whole flow from a question to an answer on screen
  const q = question.trim(); // remove stray spaces
  if (!q) return; // ignore empty questions
  $('status').textContent = 'Working on it...'; // tell the user something is happening
  $('ask-btn').disabled = true; // prevent double submits
  const parsed = await callApi({ task: 'parse', question: q }); // try the language model reader first
  let req = parsed ? cleanRequest(parsed.request, q) : null; // validate what it returned
  const source = req ? 'model' : 'local'; // remember which reader produced the request
  if (!req) req = parseLocal(q); // fall back to the built in reader
  const res = answer(req); // look up and compute the answer
  current = res; // remember it for the viewer
  const out = $('output'); // where the answer goes
  const explained = res.kind === 'help' ? null : await callApi({ task: 'explain', facts: facts(res) }); // ask the language model for a plain explanation
  const text = explained && explained.text ? explained.text : explainLocal(res); // use the built in explanation if there is none
  const inputs = await inputsBlock(res); // build the inputs panel if this answer has one
  out.innerHTML = `<section class="panel"><h2>Your question</h2><p class="quote">${esc(q)}</p>${understood(req, source)}</section><section class="panel"><h2>Result</h2>${resultCard(res)}</section>${res.kind === 'help' ? '' : `<section class="panel"><h2>What this means</h2><p>${esc(text)}</p></section>`}${chartBlock(res)}${inputs}${notesBlock(res)}`; // draw every panel in order
  out.hidden = false; // reveal the output area
  $('status').textContent = ''; // clear the status line
  $('ask-btn').disabled = false; // allow another question
  wireInputs(); wireTooltip(); // attach the buttons and the tooltip
  out.scrollIntoView({ behavior: 'smooth', block: 'start' }); // bring the answer into view
  saveRecent(q); // remember the question
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
