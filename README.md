# SorbLab

SorbLab is a small web tool that answers one question: how strongly does a gas stick to a metal surface?
You type a question in plain words. It returns the calculated adsorption energy, a plain explanation, a comparison chart,
and the Quantum ESPRESSO input files that reproduce the number.

Built for MaterialsGPT Africa, Track 03: connect a language model to physics based simulation, a surrogate model and workflow automation.

## What it does

0. A visual picker: choose a metal on a mini periodic table, turn the real surface in 3D (drag, Top and Side views, click a top atom), choose a gas, then see the gas above the surface as used in the calculation. Atoms are read from the generated input files, so the picture is the calculation.
1. Or reads a question such as "How strongly does SO2 stick to calcium?". A language model does the reading when a key is set. A built in reader does it otherwise.
2. Looks up the result in a table of 36 DFT calculations (12 metals and 3 gases: CO2, CO, SO2).
3. For a metal with no calculation (Cs, Ba, Zn, Cd, Tl) it gives a clearly labelled estimate from a small ridge regression on electronegativity and atom size. The Results page shows how wrong that model usually is.
4. Writes a short explanation. The language model may only use numbers it was given. The server rejects any reply with an invented number.
5. Generates the three input files (surface, surface with gas, gas alone) and a run script, and offers them as a zip.

## Honest limits

The numbers are PBE, no dispersion correction, clean metal slabs, gas placed at a fixed height and not relaxed. The Ga with SO2 value is flagged as unusual. The surrogate is only useful for CO2. Porous materials such as MOFs are not covered yet.

## Folder map

| Path | Purpose |
| --- | --- |
| index.html, results.html, help.html | The three pages |
| css/style.css | All styling, light and dark |
| js/data.js | Results, metal properties, settings |
| js/engine.js | Question reader, lookup, surrogate model, explanations, input bundles |
| js/app.js, js/results.js | Page logic |
| js/viewer.js, js/structures.js | The 3D atom viewer (plain canvas, no library) and the code that reads atom positions from the input files |
| js/chart.js, js/zip.js, js/icons.js, js/theme.js | Chart, zip writer, icons, theme switch |
| js/inputs.js | Generated input files (made by scripts/make_inputs.py) |
| api/ask.js | Server function that calls the language model and checks its reply |
| pipeline/ | The original calculation scripts that produced the numbers, unmodified |
| tests/ | Engine and API tests |

## Run it locally

You need Node 18 or newer.

```bash
npm run dev      # then open http://localhost:3000
npm test         # runs the engine and API tests, no key needed
```

Without a key the site still works fully using the built in reader.

## Turn on the language model

Set these in the Vercel project settings (Settings, Environment Variables), never in the code:

* `ANTHROPIC_API_KEY` is your key.
* `LLM_MODEL` is optional. The default is a small fast model.

For local testing: `ANTHROPIC_API_KEY=your_key npm run dev`

## Deploy

1. Push this folder to a public GitHub repository.
2. In Vercel choose Add New Project, import the repository.
3. Framework Preset: Other. Leave build command and output directory empty.
4. Add the environment variable above and press Deploy.

## Data and licence

MIT licence for the code. The adsorption energies come from the author's own Quantum ESPRESSO runs with pslibrary PAW pseudopotentials.
