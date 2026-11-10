# Done

- KiCad board parser for every format from KiCad 4 to 10, checked against pcbnew on 19 boards
- Part kinds from reference prefix, footprint and descriptions
- Value parsing with SI prefixes, RKM codes, ratings; loose matching of unspecified ratings (setting)
- Fuzzy search over reference, value, footprint and fields, reading quantities (100n finds 0.1uF)
- GitHub link resolver: repository, folder, file, raw and SSH links; picker for several boards; jsDelivr fallback; LFS
- Canvas board view: outline, pads, part outlines, schematic symbols, reference and value labels, pan, pinch, wheel, tap
- Bottom view mirrored, side switch, parts on the other side flagged
- Parts list as a bottom sheet resized from its handle and collapsible
- Tap a part or a row to light up every part of the same value
- Placed marks per board, kept across reloads
- Settings: loose ratings, match footprint, pads, labels, solarized light/dark/auto
- Local .kicad_pcb files and recent boards on the home screen
- Browser checks in headless Chromium at phone and desktop size
- GitHub Pages workflow
