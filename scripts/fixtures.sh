#!/usr/bin/env bash
# Fetch KiCad demo boards in every file format from KiCad 4 to 10 into
# tests/fixtures/, and next to each one the JSON that KiCad's own pcbnew
# computes for it (scripts/kicad_truth.py). tests/fixtures.test.ts compares
# the parser against those dumps. The boards are KiCad's GPL demos, so they
# are downloaded here instead of being committed.
set -euo pipefail

out=tests/fixtures
mkdir -p "$out"
mirror=https://raw.githubusercontent.com/KiCad/kicad-source-mirror

# Old formats from the KiCad source mirror: <release tag> <demo path>.
for tag in 4.0.7 5.1.12 6.0.11 7.0.11 8.0.9; do
    for demo in pic_programmer/pic_programmer video/video; do
        dest="$out/k${tag%%.*}-$(basename "$demo").kicad_pcb"
        [ -s "$dest" ] || curl -sSfL -o "$dest" "$mirror/$tag/demos/$demo.kicad_pcb"
    done
done

# KiCad 9 and 10 formats from the demos installed with KiCad.
demos=/usr/share/kicad/demos
for demo in ecc83/ecc83-pp interf_u/interf_u microwave/microwave \
            pic_programmer/pic_programmer video/video stickhub/StickHub \
            complex_hierarchy/complex_hierarchy; do
    src="$demos/$demo.kicad_pcb"
    [ -f "$src" ] || { echo "skip $src (not installed)"; continue; }
    cp -f "$src" "$out/local-$(basename "$demo").kicad_pcb"
done

for b in "$out"/*.kicad_pcb; do
    j="${b%.kicad_pcb}.truth.json"
    [ -s "$j" ] && [ "$j" -nt "$b" ] && continue
    /usr/bin/python3 scripts/kicad_truth.py "$b" "$j"
done
ls -1 "$out" | sed 's/^/  /'
