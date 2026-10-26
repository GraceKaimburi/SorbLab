#!/bin/bash
# STEP 2, CALCULATE (Quantum ESPRESSO)
# Runs the three calculations for one element and one gas. The surface is shared by all gases.
# Usage: ./step2_calculate.sh Na SO2      (the gas is CO2 if you leave it out)

EL=$1                                                   # the element you typed after the script
GAS=${2:-CO2}                                           # the gas you typed, CO2 if none given
NP=4                                                    # CPU cores, change to match your machine
GASDIR=$(cat runs/$EL/gas_folder_$GAS.txt)              # which gas folder step 1 chose for this element

run() {                                                 # runs one QE job inside its folder
    dir=$1
    name=$2
    if cmp -s $dir/$name.in $dir/$name.in.done; then    # skip only if this exact input already finished
        echo "$name already finished with these settings, skipping"
        return
    fi
    echo "running $name"
    (cd $dir && mpirun -np $NP pw.x -in $name.in > $name.out)
    if grep -q "convergence has been achieved" $dir/$name.out; then
        cp $dir/$name.in $dir/$name.in.done             # remember which input this result belongs to
    else
        echo "WARNING: $name did not converge, check $dir/$name.out"
    fi
}

run $GASDIR ${GAS}_gas                                  # E_gas, the lone molecule
run runs/$EL ${EL}_surface                              # E_surface, the clean surface
run runs/$EL ${EL}_${GAS}_system                        # E_system, gas sitting on the surface
