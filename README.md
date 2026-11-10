# human-pnp

A phone-first web page for placing parts on a KiCad board by hand. Paste a
GitHub link to a repository, folder or `.kicad_pcb` file (or open a local
file) and it draws the board with an outline, a schematic symbol, the
reference and the value of every part; tap a part to light up every part of
the same value, search, and tick parts off as you place them. It runs
entirely in the browser; https://hpnp.tmpk.sh serves it from Cloudflare.

Day to day:

- `mise run dev` - serve the app with live reload on http://localhost:3000
- `mise run test` - unit tests
- `mise run e2e` - build, then drive the site in headless Chromium at phone and desktop size (screenshots in `shots/`)
- `mise run check` - type-check
- `mise run preview` - serve the built site, reachable from a phone on the same network

Pushing to `main` publishes the site: Cloudflare runs the build in
`wrangler.jsonc` and serves `dist/`. `mise tasks` lists the rest;
[NOTES.md](NOTES.md) holds the decisions and pitfalls,
[ARCHITECTURE.md](ARCHITECTURE.md) the structure.
