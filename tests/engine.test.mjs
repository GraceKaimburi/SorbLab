// engine.test.mjs: quick checks that the logic gives the numbers we expect. Run with: node tests/engine.test.mjs
import assert from 'node:assert/strict'; // the built in assertion helper
import { parseLocal, answer, explainLocal, looError, baselineError, estimate, buildBundle, toCsv, fmt } from '../js/engine.js'; // the code under test

let r = parseLocal('How strongly does SO2 stick to calcium?'); // a typical question
assert.equal(r.intent, 'single'); assert.deepEqual(r.elements, ['Ca']); assert.deepEqual(r.gases, ['SO2']); // one metal, one gas
r = parseLocal('Which metal binds carbon dioxide the best?'); // a ranking question
assert.equal(r.intent, 'rank'); assert.deepEqual(r.gases, ['CO2']); // no metal, one gas
r = parseLocal('Compare Ca and Sr for CO2'); // a comparison
assert.equal(r.intent, 'compare'); assert.deepEqual(r.elements, ['Ca', 'Sr']); // two metals
r = parseLocal('In which metals does CO stick?'); // the word In must not become indium
assert.equal(r.elements.length, 0); assert.deepEqual(r.gases, ['CO']); // no metals found
r = parseLocal('what about caesium and CO2'); // an estimate only element
assert.equal(r.intent, 'estimate'); assert.deepEqual(r.candidates, ['Cs']); // found by name

const a = answer(parseLocal('SO2 on calcium')); // a full answer
assert.equal(a.kind, 'single'); assert.equal(a.value, -0.753); assert.equal(a.rank, 1); // calcium is the strongest SO2 binder
assert.ok(Math.abs(a.kj - -72.65) < 0.1); // -0.753 eV is about -72.7 kJ per mol
const g = answer(parseLocal('SO2 on gallium')); // the flagged outlier
assert.ok(g.flag); // it must carry its warning
assert.ok(explainLocal(g).includes('Warning')); // and the warning must reach the text

for (const gas of ['CO2', 'CO', 'SO2']) console.log(gas, 'model error', looError(gas).toFixed(3), 'guess error', baselineError(gas).toFixed(3)); // print the model quality
assert.ok(looError('CO2') < 0.08); // CO2 is predicted well, matches the earlier Python check
assert.ok(Math.abs(looError('SO2') - 0.365) < 0.02); // SO2 is poor, matches the earlier Python check
const e = estimate('Cs', 'CO2'); // an estimate outside the training range
assert.ok(e.outside.includes('radius')); // caesium is larger than any calculated metal

const b = await buildBundle('Ca', 'SO2', '/home/user/pseudo'); // the input files for calcium and SO2
assert.equal(b.files.length, 3); assert.ok(b.files[0].content.includes("pseudo_dir       = '/home/user/pseudo'")); // placeholder replaced
assert.ok(!b.files.some((f) => f.content.includes('@@'))); // nothing left over
assert.equal(b.files[1].info.atoms, 19); // 16 calcium atoms plus S and 2 O
assert.deepEqual(b.files[1].info.kpoints, [4, 4, 1]); // k grid from the density rule
assert.equal(b.cutoff, 50); // calcium cutoff
assert.ok(b.script.includes('mpirun -np 4 pw.x')); // the script runs the program
assert.equal(toCsv().trim().split('\n').length, 13); // header plus 12 metals
assert.equal(fmt(-0.0544), '−0.054'); assert.equal(fmt(0.2), '+0.200'); // sign formatting
console.log('all engine tests passed'); // success message
