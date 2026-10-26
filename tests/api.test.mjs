// api.test.mjs: checks the server function with a pretend language model, so no key or internet is needed.
// Run with: node tests/api.test.mjs

import assert from 'node:assert/strict'; // simple yes or no checks

process.env.ANTHROPIC_API_KEY = 'test-key-not-real'; // a made up key so the function believes a key exists
const { default: handler } = await import('../api/ask.js'); // load the function after the key is set

function fakeRes() { // a stand in for the response object Vercel passes in
  return { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; // records what the function sends
}

function mockModel(text) { // replaces fetch with a pretend model that always answers with the given text
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }); // the same shape as the real service
}

async function call(body, method = 'POST') { // calls the handler and returns the response record
  const res = fakeRes(); // a fresh response recorder
  await handler({ method, body }, res); // run the function
  return res; // hand back what it sent
}

mockModel('Sure: {"intent":"single","elements":["Ca","Xx"],"candidates":[],"gases":["SO2","H2O"]}'); // a reply with a made up metal and gas mixed in
let r = await call({ task: 'parse', question: 'SO2 on calcium' }); // read a question
assert.deepEqual(r.body.request, { intent: 'single', elements: ['Ca'], candidates: [], gases: ['SO2'] }); // the invented symbols must be removed
console.log('ok parse cleans unknown symbols'); // report

mockModel('no json here at all'); // a reply that is not JSON
r = await call({ task: 'parse', question: 'hello' }); // read a question
assert.equal(r.body.fallback, true); // the page must be told to fall back
console.log('ok parse falls back on junk'); // report

mockModel('{"intent":"fly","elements":[],"candidates":[],"gases":[]}'); // an intent we do not know
r = await call({ task: 'parse', question: 'x' }); // read a question
assert.equal(r.body.fallback, true); // must fall back
console.log('ok parse rejects bad intent'); // report

const facts = { kind: 'single', energy_eV: -0.753, kJ_per_mol: -72.6, rank: 1, of: 12 }; // some facts to explain
mockModel('Calcium gives -0.753 eV, about -72.6 kJ per mol, rank 1 of 12 — a strong pull.'); // an honest explanation with a long dash
r = await call({ task: 'explain', facts }); // explain
assert.ok(r.body.text && !/[—–]/.test(r.body.text)); // text is returned with no long dashes
console.log('ok explain accepts honest text'); // report

mockModel('Calcium gives -0.999 eV which is amazing.'); // an explanation with an invented number
r = await call({ task: 'explain', facts }); // explain
assert.equal(r.body.fallback, true); // must be rejected
console.log('ok explain rejects invented numbers'); // report

globalThis.fetch = async () => { throw new Error('network down'); }; // a failing network
r = await call({ task: 'parse', question: 'SO2 on calcium' }); // read a question
assert.equal(r.body.fallback, true); // must fall back, not crash
console.log('ok network failure falls back'); // report

r = await call({ task: 'nope' }); // an unknown task
assert.equal(r.code, 400); // must be an error
r = await call({}, 'GET'); // the wrong method
assert.equal(r.code, 405); // must be refused
console.log('ok bad requests refused'); // report

console.log('all api tests passed'); // done
