# Architecture

A static page: everything below runs in the browser. GitHub (or jsDelivr
when GitHub's API limit is used up) is the only outside service.

```mermaid
flowchart LR
    subgraph outside[Outside services]
        api[api.github.com<br/>git tree listing]
        jsd[data.jsdelivr.com<br/>listing fallback]
        raw[raw.githubusercontent.com<br/>file contents]
        lfs[media.githubusercontent.com<br/>Git LFS files]
    end

    subgraph app[Page]
        main[main.ts<br/>address routing, home,<br/>board picker, loading]
        github[github.ts<br/>link parsing, listing,<br/>download]
        sexpr[sexpr.ts<br/>s-expression reader]
        kicad[kicad.ts<br/>board model]
        geometry[geometry.ts<br/>arcs, boxes, outline loops]
        classify[classify.ts<br/>part kinds]
        values[values.ts<br/>value parsing, matching]
        parts[parts.ts<br/>placeable parts, value groups]
        fuzzy[fuzzy.ts<br/>search scoring]
        screen[boardscreen.ts<br/>selection, search, list,<br/>settings]
        view[view.ts<br/>canvas drawing, pan, zoom, tap]
        symbols[symbols.ts<br/>schematic symbols]
        sheet[sheet.ts<br/>bottom sheet]
        store[store.ts<br/>localStorage]
    end

    main --> github
    github --> api
    github --> jsd
    github --> raw
    github --> lfs
    main --> kicad
    kicad --> sexpr
    kicad --> geometry
    main --> screen
    screen --> parts
    parts --> classify
    parts --> values
    screen --> fuzzy
    screen --> view
    screen --> sheet
    screen --> store
    view --> symbols
    view --> geometry
    main --> store
```

Data flow for one board: text -> `parseBoard` (footprints with pads, body
outline, placement and flags; Edge.Cuts loops) -> `makeParts` (kind, parsed
value, placeable) -> `buildGroups` (one group per part kind and value) ->
`BoardView` builds `Path2D` batches per side and draws; the board screen
keeps the selection, search hits and placed marks in a `ViewState` the view
reads on every frame.

Opening a board from a repository link, with rough times for a 5 MB board
on a laptop (the download depends on the network):

```mermaid
gantt
    title Opening a board (milliseconds)
    dateFormat x
    axisFormat %L
    section Network
    List the git tree (1 API call)   :list, 0, 300
    Download from raw.githubusercontent :dl, after list, 700
    section Page
    Parse the board                  :parse, after dl, 20
    Classify, read values, group     :group, after parse, 5
    Build Path2D layers              :layers, after group, 30
    First draw                       :draw, after layers, 5
```

Tests: unit tests per module in `tests/` (`bun test`); the parser is checked
against pcbnew's own numbers (`tests/truth.ts`) on committed boards in
`tests/data/` and downloaded KiCad demos in `tests/fixtures/`; the browser
checks in `tests/e2e.test.ts` drive the built site.
