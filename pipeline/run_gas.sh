#!/bin/bash
# run_gas.sh  Usage: nohup ./run_gas.sh CO2 CO SO2 > batch_next.log 2>&1 &
METALS="Li Na K Rb Be Mg Ca Sr Al Ga In Sn"
for gas in "$@"; do
    for el in $METALS; do
        echo "starting $el with $gas"
        python3 step1_build.py $el $gas || { echo "$el $gas BUILD failed, skipping"; continue; }
        ./step2_calculate.sh $el $gas
        python3 step3_subtract.py $el $gas || echo "$el $gas SUBTRACT failed, check its .out files"
    done
done
echo "batch finished"
