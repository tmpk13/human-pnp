# Notes

Decisions and non-obvious problems, with the reason for each.

## Language and build

- TypeScript with bun, not Rust compiled to WebAssembly: the whole program
  runs in the browser and is mostly drawing and DOM work. Parsing in plain
  TypeScript is fast enough (an 85 MB board in 0.64 s, a 6 MB board in
  17 ms under bun), so a WASM toolchain would add build steps for nothing.
- `bun build ./index.html` bundles the page and writes relative asset URLs
  (`./index-<hash>.js`), so the same `dist/` works at a site root and below
  one. No minification: debug builds only, with source maps.

## Hosting

- https://hpnp.tmpk.sh is a Cloudflare Worker serving static assets. Without
  a build step it published the repository root: the browser got the source
  `index.html`, which loads `./src/main.ts`, and Cloudflare sends `.ts` as
  `video/mp2t` (MPEG transport stream), so the module never ran.
  `wrangler.jsonc` now runs `scripts/cloudflare-build.sh` and serves only
  `dist/`. Its `name` must match the Worker in the Cloudflare dashboard.
- The Cloudflare build does not use mise: mise resolves `bun = "1.4.4"`
  through GitHub's API, and Cloudflare's build machines share IP addresses
  whose 60 unauthenticated calls an hour are usually gone (the first
  Cloudflare build, which used mise, failed inside the build script). The
  script reads the bun version
  from `mise.toml`, installs that bun from npm, and runs `bun run build`,
  the same `package.json` script `mise run build` runs.
- GitHub Pages is not used; `.github/workflows/ci.yml` only tests and
  builds.

## Reading .kicad_pcb files

- One s-expression reader handles KiCad 4 to 10. Quoted and bare atoms are
  the same thing (`(fp_text reference R1)` in KiCad 5 is
  `(fp_text reference "R1")` later). References and values come from
  `fp_text reference/value` (up to KiCad 7) or `property "Reference"/"Value"`
  (KiCad 8+).
- Large boards are mostly tracks, vias and zone fills. The reader skips
  every top-level list except footprints, `gr_*` graphics, the layer table
  and the title, and inside footprints skips models, zones, embedded files
  and text effects, without building nodes for them.
- KiCad 4/5 boards refer to copper layers by their user names
  (`(layer Composant)`, `(layer top_layer)`), not `F.Cu`. The layer table
  maps them back: in those versions layer number 0 is the front copper and
  31 the back. KiCad 6+ items use canonical names. Without this, back-side
  parts of old boards read as front-side.
- A pad's `(at x y angle)` holds its position in the footprint's frame but
  its angle on the board (footprint rotation included); the model keeps the
  angle relative to the footprint.
- KiCad 4/5 arcs are (center, start point, sweep angle); a positive sweep
  turns clockwise on screen (Y down). KiCad 6+ arcs are start, mid, end.
  `tests/data/legacy-k5.kicad_pcb` pins this down against pcbnew.
- A back-side footprint stores its items already mirrored, so the same
  placement (rotate, then translate) gives board coordinates; the bottom
  view mirrors X when drawing.
- `(attr ...)` carries `smd`, `dnp`, `exclude_from_bom`, `board_only`, and
  in KiCad 5 `virtual` (not placed).
- The part outline is the fabrication layer drawing when there is one, else
  the courtyard pulled in by 0.2 mm, else the silkscreen, else the pads.

## Ground truth for the parser

- KiCad 10's `pcbnew` Python module reads every older format, so it is the
  reference: `scripts/kicad_truth.py` dumps footprints, pads and the
  Edge.Cuts outline it computes, and the tests compare every position,
  rotation, size and outline point. It needs the system `python3` that
  ships KiCad's bindings (pixi cannot provide them).
- `mise run fixtures` downloads KiCad's own demo boards from five releases
  (4.0 to 8.0) plus the installed KiCad 9/10 demos into `tests/fixtures/`.
  They are GPL, so they are downloaded rather than committed.
- `tests/data/sample.kicad_pcb` comes from `scripts/make_sample.py`
  (pcbnew, KiCad's stock footprints) and is committed with its truth file,
  so the tests and browser checks run without KiCad installed.
- pcbnew scripting: `FOOTPRINT.Flip()` on a footprint not yet added to a
  board segfaults (it reads the board's layer stack). Add it first.

## Finding boards on GitHub

- Unauthenticated GitHub API calls are limited to 60 an hour per IP
  address, and phone networks often share one address among many users.
  Listing costs one call: `git/trees/<ref>[:<folder>]?recursive=1`, with
  `HEAD` when no branch is given. The `ref:folder` form lists only that
  folder, which keeps big repositories (KiCad's own) from being truncated.
- File contents come from `raw.githubusercontent.com`, which has no such
  limit and sends CORS headers. Git LFS files arrive as pointers there and
  are fetched again from `media.githubusercontent.com`.
- When the API limit is used up, the listing comes from jsDelivr's GitHub
  mirror (`data.jsdelivr.com/v1/packages/gh/<owner>/<repo>@<branch>`).
  It needs a branch name, so it tries the given one, else `main` and
  `master`.
- Branch names may contain slashes, so `tree/feat/x/hw` is ambiguous.
  Folder links try each split, shortest ref first, against the tree API.
  File links need no splitting: every split gives the same raw URL and
  GitHub resolves the ref.
- No GitHub token setting: a token kept in localStorage is readable by any
  script on the same origin, and on GitHub Pages every project site of an
  account shares `<user>.github.io`. Storage keys carry a `human-pnp:`
  prefix for the same reason.

## Values and matching

- Values are read as quantities only for passives, crystals and fuses
  (`DEFAULT_UNIT` in `src/values.ts`); otherwise `2N7002` would read as
  2.7002 nF. Other parts compare by their first word plus ratings.
- Equal values in different spellings group together: `4k7`, `4.7k`,
  `4700R`; `100n`, `0.1uF`; `16M` and `16.000MHz` on a crystal. Numbers are
  rounded to 6 significant digits so float error does not split groups.
- Leading-R values (`R010` = 0.010 ohm) stop at three digits, because
  `R0402_500R_1%` names a package first. A value that does not start with
  its quantity takes the first later word that is one and has a unit or
  multiplier letter (`500R`); bare numbers such as `742792040` are part
  numbers.
- Loose matching (the default, "Match unspecified ratings") ignores a
  rating that only one side gives: `1uF` matches `1uF 25V` and `1uF 50V`,
  but `1uF 25V` and `1uF 50V` still differ. This is not transitive, so the
  list keeps strict groups and lights up the related ones.
- Search scores in-order character matches and keeps results within 60 %
  of the best score, so `c1` finds C1 and C10-C19 but not C21. A term that
  reads as the same quantity as a part's value scores as an exact match
  (`100n` finds a part written `0.1uF`).

## Drawing

- The canvas sits `position: absolute; inset: 0` in a box sized by CSS,
  so its size never depends on its own drawing buffer (a canvas sized from
  its own box grows a pixel per ResizeObserver round). The first fit
  happens at the first non-zero size, not at construction.
- Everything static is built once per side into a few `Path2D` batches
  (pads, pad 1, holes, outlines, symbols bucketed by size), so a frame is a
  handful of fill and stroke calls: under 1 ms of script per frame for a
  1500-part board in Chromium.
- Labels are drawn in screen space, so the mirrored bottom view never
  mirrors text. Each part gets its reference on one side and value on the
  other, outside its pads; the other pair of sides is tried when the first
  is taken, and labels that still collide are left out until zooming in
  makes room. Highlighted parts are labeled first, on a backing.
- Two-terminal symbols are turned along the pad 1 to pad 2 axis. KiCad's
  libraries put a diode's or LED's cathode on pad 1 and a polarized
  capacitor's or battery's plus on pad 1, so the drawn bar and "+" land on
  the right pad. Pad 1 is colored only on parts where orientation matters.

## Browser checks

- `tests/e2e.test.ts` runs only with `E2E=1` (`mise run e2e`). It serves
  `dist/` under `/human-pnp/`, answers GitHub requests from `tests/data`
  through Playwright routing, and fails on any console error or other
  outside request.
- The board screen sets a read-only `window.humanPnp` (view, parts,
  groups) so the checks can find where a part is drawn; it changes no
  behavior.
