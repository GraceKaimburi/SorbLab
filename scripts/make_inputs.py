# make_inputs.py: packs the Quantum ESPRESSO input files made by the pipeline into one JavaScript file the website can serve.
# Usage: python3 scripts/make_inputs.py /path/to/runs js/inputs.js
# It must be run after step1_build.py has been run for every element and gas (see pipeline/step1_build.py).

import sys                                              # reads the folder names typed after the script
import re                                               # finds and replaces the absolute pseudopotential folder
import glob                                             # lists the input files in the runs folder
import os                                               # splits file paths into folder and file names

runs, out = sys.argv[1], sys.argv[2]                    # where the pipeline wrote its files, and where to write the JavaScript
surface, system, gas = {}, {}, {}                       # the three groups of input files, filled in below
TOKEN = '@@PSEUDO_DIR@@'                                # placeholder the website swaps for the user's own pseudopotential folder

def clean(text):                                        # makes one input file safe to store and portable to another computer
    text = re.sub(r"pseudo_dir\s*=\s*'[^']*'", f"pseudo_dir       = '{TOKEN}'", text)  # remove this computer's folder path
    assert '`' not in text and '${' not in text and '\\' not in text   # these characters would break a JavaScript template string
    return text                                         # the cleaned text

for path in sorted(glob.glob(f'{runs}/*/*.in')):        # every input file in every element or gas folder
    folder, name = os.path.basename(os.path.dirname(path)), os.path.basename(path)[:-3]   # for example Ca and Ca_SO2_system
    text = clean(open(path).read())                     # read and clean the file
    if folder.endswith(tuple(f'_gas_ecut{c}' for c in (50, 60, 70, 105))):   # a lone gas molecule run
        g, cut = re.match(r'([A-Z0-9]+)_gas_ecut(\d+)', folder).groups()     # which gas and which cutoff
        gas[f'{g}|{cut}'] = text                        # key such as SO2|105
    elif name.endswith('_surface'):                     # the bare metal slab
        surface[folder] = text                          # key such as Ca
    else:                                               # the metal slab with a gas above it
        g = name.split('_')[1]                          # the gas name sits in the middle of the file name
        system[f'{folder}|{g}'] = text                  # key such as Ca|SO2

def block(title, comment, data):                        # turns one group of files into a JavaScript object
    lines = [f'// {comment}', f'export const {title} = {{']   # a comment and the start of the object
    for key in sorted(data):                            # keep the order stable so the file changes only when the inputs do
        lines.append(f"  '{key}': `{data[key]}`,")      # one entry, the whole input file inside a template string
    lines.append('};')                                  # close the object
    return '\n'.join(lines)                             # join into one block of text

header = ('// inputs.js: GENERATED FILE, do not edit by hand. Made by scripts/make_inputs.py from the pipeline output.\n'
          '// Each entry is a complete Quantum ESPRESSO input file. The placeholder @@PSEUDO_DIR@@ is replaced in the browser.\n')  # explains where the file came from
body = '\n\n'.join([block('SURFACE_INPUTS', 'bare metal slab, one per element', surface),
                    block('SYSTEM_INPUTS', 'metal slab with the gas 2.5 angstrom above it, one per element and gas', system),
                    block('GAS_INPUTS', 'lone gas molecule in an empty box, one per gas and cutoff', gas)])   # the three groups
open(out, 'w').write(header + '\n' + body + '\n')       # write the finished JavaScript file
print(len(surface), 'surfaces,', len(system), 'systems,', len(gas), 'gas files written to', out)   # a short report
