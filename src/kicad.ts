// Board model from a .kicad_pcb file (every s-expression format from
// KiCad 4 to KiCad 10).
//
// Coordinates stay in KiCad's frame: millimeters, Y downward. Each
// footprint keeps its own items in its local frame (as the file stores
// them) plus its placement (x, y, rot, side); a local point p lands on the
// board at (x, y) + rotate(p, rot). For a footprint flipped to the back the
// file already stores mirrored local items, so the same rule holds and the
// result is the board as seen from the front.

import {
    addBox,
    addPoint,
    addPoints,
    arcFrom3,
    arcLegacy,
    bezierPoints,
    boxHeight,
    boxValid,
    boxWidth,
    chainPolylines,
    emptyBox,
    flattenArc,
    inflate,
    placePoints,
    rotate,
    type BBox,
} from "./geometry";
import { atom, atoms, child, children, isList, num, parseSexpr, type SList } from "./sexpr";

export type Side = "F" | "B";

export interface Pad {
    num: string;
    // circle, rect, oval, roundrect, trapezoid or custom.
    shape: string;
    // Center in the footprint's local frame.
    x: number;
    y: number;
    // Degrees counterclockwise, relative to the footprint.
    rot: number;
    w: number;
    h: number;
    // Roundrect corner radius as a fraction of the shorter side.
    rratio: number;
    // Hole size; both zero for a surface pad.
    drillW: number;
    drillH: number;
    // Copper on the front / back side.
    front: boolean;
    back: boolean;
    // Custom pad outlines in the pad's own frame (flat x, y lists).
    poly?: number[][];
}

export type BodySource = "fab" | "courtyard" | "silk" | "pads" | "none";

export interface Footprint {
    id: number;
    ref: string;
    value: string;
    // Library id such as "Resistor_SMD:R_0603_1608Metric".
    lib: string;
    // The footprint library's description.
    descr: string;
    // Other fields copied from the schematic (Description, MPN, ...).
    props: Record<string, string>;
    x: number;
    y: number;
    rot: number;
    side: Side;
    // Outline of the part body in the local frame.
    body: BBox;
    bodyFrom: BodySource;
    // Body and pads together, local frame.
    extent: BBox;
    pads: Pad[];
    smd: boolean;
    dnp: boolean;
    noBom: boolean;
    noPos: boolean;
    boardOnly: boolean;
}

export interface Board {
    version: number;
    generator: string;
    title: string;
    footprints: Footprint[];
    // Board outline loops (Edge.Cuts) in the board frame, as flat x, y lists.
    outline: number[][];
    // Edge.Cuts pieces that do not close into a loop.
    outlineOpen: number[][];
    // Outline plus every footprint.
    bounds: BBox;
}

export class BoardError extends Error {}

// Top-level lists worth building; everything else (tracks, vias, zones,
// nets, text) is skipped while reading.
const KEEP_TOP = new Set([
    "version",
    "generator",
    "host",
    "layers",
    "title_block",
    "footprint",
    "module",
    "gr_line",
    "gr_arc",
    "gr_circle",
    "gr_rect",
    "gr_poly",
    "gr_curve",
]);

// Lists inside footprints that nothing here reads.
const SKIP_INNER = new Set([
    "model",
    "zone",
    "embedded_files",
    "embedded_fonts",
    "effects",
    "uuid",
    "tstamp",
    "tedit",
    "net",
    "pintype",
    "pinfunction",
    "teardrops",
    "group",
    "stroke",
    "tenting",
    "covering",
    "plugging",
    "capping",
    "filling",
    "render_cache",
    "die_length",
    "path",
    "sheetfile",
    "sheetname",
    "tags",
    "zone_connect",
    "thermal_bridge_angle",
    "thermal_width",
    "thermal_gap",
    "solder_mask_margin",
    "solder_paste_margin",
    "solder_paste_margin_ratio",
    "clearance",
    "padstack",
]);

function skip(head: string, depth: number): boolean {
    if (depth === 1) return !KEEP_TOP.has(head);
    return depth > 1 && SKIP_INNER.has(head);
}

function xy(list: SList | undefined): [number, number] {
    return [num(list, 0), num(list, 1)];
}

// Maps the layer names used inside the file to KiCad's canonical names.
// KiCad 4/5 boards refer to copper layers by their user names, e.g.
// (layer Composant) for the front of a board drawn in French, where layer
// number 0 is the front copper and 31 the back. KiCad 6+ items use the
// canonical names and keep the user name as a fourth field.
type LayerNames = Map<string, string>;

function layerNames(root: SList, version: number): LayerNames {
    const map: LayerNames = new Map();
    const table = child(root, "layers");
    if (!table) return map;
    const legacy = version < 20200000;
    for (const e of table.items) {
        if (!isList(e)) continue;
        const n = Number(e.head);
        const name = atom(e, 0);
        if (!name) continue;
        if (legacy && Number.isInteger(n) && n >= 0 && n <= 31) {
            map.set(name, n === 0 ? "F.Cu" : n === 31 ? "B.Cu" : `In${n}.Cu`);
        }
        const user = atom(e, 2);
        if (user && !map.has(user)) map.set(user, name);
    }
    return map;
}

function layerOf(item: SList, names?: LayerNames): string {
    const l = atom(child(item, "layer"), 0) ?? "";
    return names?.get(l) ?? l;
}

// Point list of a (pts (xy ..) (arc (start ..) (mid ..) (end ..)) ...) list.
function ptsPoints(pts: SList | undefined): number[] {
    const out: number[] = [];
    if (!pts) return out;
    for (const it of pts.items) {
        if (!isList(it)) continue;
        if (it.head === "xy") {
            out.push(num(it, 0), num(it, 1));
        } else if (it.head === "arc") {
            const [sx, sy] = xy(child(it, "start"));
            const [mx, my] = xy(child(it, "mid"));
            const [ex, ey] = xy(child(it, "end"));
            const a = arcFrom3(sx, sy, mx, my, ex, ey);
            out.push(...(a ? flattenArc(a) : [sx, sy, ex, ey]));
        }
    }
    return out;
}

// Polylines of one graphic item (gr_* or fp_*) in its own frame.
export function shapeLines(g: SList): number[][] {
    const kind = g.head.slice(3); // line, rect, circle, arc, poly, curve
    switch (kind) {
        case "line": {
            const [sx, sy] = xy(child(g, "start"));
            const [ex, ey] = xy(child(g, "end"));
            return [[sx, sy, ex, ey]];
        }
        case "rect": {
            const [x0, y0] = xy(child(g, "start"));
            const [x1, y1] = xy(child(g, "end"));
            return [[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]];
        }
        case "circle": {
            const [cx, cy] = xy(child(g, "center"));
            const [ex, ey] = xy(child(g, "end"));
            const r = Math.hypot(ex - cx, ey - cy);
            return r > 0 ? [flattenArc({ cx, cy, r, a0: 0, sweep: 2 * Math.PI })] : [];
        }
        case "arc": {
            const [sx, sy] = xy(child(g, "start"));
            const [ex, ey] = xy(child(g, "end"));
            const mid = child(g, "mid");
            if (mid) {
                const [mx, my] = xy(mid);
                const a = arcFrom3(sx, sy, mx, my, ex, ey);
                return [a ? flattenArc(a) : [sx, sy, ex, ey]];
            }
            // KiCad 4/5: start is the center, end is where the arc begins.
            const angle = num(child(g, "angle"), 0);
            return [flattenArc(arcLegacy(sx, sy, ex, ey, angle))];
        }
        case "poly": {
            const p = ptsPoints(child(g, "pts"));
            if (p.length >= 4) p.push(p[0]!, p[1]!);
            return p.length >= 4 ? [p] : [];
        }
        case "curve": {
            const p = ptsPoints(child(g, "pts"));
            return p.length >= 8 ? [bezierPoints(p)] : [];
        }
        default:
            return [];
    }
}

const GRAPHIC_HEADS = new Set(["fp_line", "fp_rect", "fp_circle", "fp_arc", "fp_poly", "fp_curve"]);

function padLayers(pad: SList, names: LayerNames): { front: boolean; back: boolean } {
    let front = false;
    let back = false;
    for (const raw of atoms(child(pad, "layers"))) {
        const l = names.get(raw) ?? raw;
        if (l === "*.Cu" || l === "F&B.Cu") front = back = true;
        else if (l === "F.Cu") front = true;
        else if (l === "B.Cu") back = true;
    }
    return { front, back };
}

function parsePad(p: SList, fpRot: number, names: LayerNames): Pad {
    const at = child(p, "at");
    const size = child(p, "size");
    const shape = atom(p, 2) ?? "rect";
    const drill = child(p, "drill");
    let drillW = 0;
    let drillH = 0;
    if (drill) {
        if (atom(drill, 0) === "oval") {
            drillW = num(drill, 1);
            drillH = num(drill, 2, drillW);
        } else {
            drillW = drillH = num(drill, 0);
        }
    }
    const pad: Pad = {
        num: atom(p, 0) ?? "",
        shape,
        x: num(at, 0),
        y: num(at, 1),
        // The file stores the pad's board orientation (footprint rotation
        // included); keep it relative to the footprint.
        rot: num(at, 2) - fpRot,
        w: num(size, 0),
        h: num(size, 1, num(size, 0)),
        rratio: num(child(p, "roundrect_rratio"), 0, shape === "roundrect" ? 0.25 : 0),
        drillW,
        drillH,
        ...padLayers(p, names),
    };
    if (shape === "custom") {
        const polys: number[][] = [];
        const prims = child(p, "primitives");
        if (prims) {
            for (const g of prims.items) {
                if (!isList(g)) continue;
                if (g.head === "gr_poly" || g.head === "gr_circle" || g.head === "gr_rect") {
                    polys.push(...shapeLines(g));
                }
            }
        }
        if (polys.length) pad.poly = polys;
    }
    return pad;
}

// Corner points of a pad in the footprint frame, for bounding boxes.
function padCorners(pad: Pad): number[] {
    const hw = pad.w / 2;
    const hh = pad.h / 2;
    const local = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
    if (pad.poly) for (const p of pad.poly) local.push(...p);
    return placePoints(local, pad.x, pad.y, pad.rot);
}

function textOf(fp: SList, kind: "reference" | "value"): string | undefined {
    const propName = kind === "reference" ? "Reference" : "Value";
    for (const it of fp.items) {
        if (!isList(it)) continue;
        if (it.head === "property" && atom(it, 0) === propName) return atom(it, 1);
        if (it.head === "fp_text" && atom(it, 0) === kind) return atom(it, 1);
    }
    return undefined;
}

// Property names that say nothing about the part itself.
const BORING_PROPS = new Set(["Reference", "Value", "Footprint", "Datasheet", "Sheetfile", "Sheetname"]);

function parseFootprint(fp: SList, id: number, edges: number[][], names: LayerNames): Footprint {
    const at = child(fp, "at");
    const x = num(at, 0);
    const y = num(at, 1);
    const rot = num(at, 2);
    const side: Side = layerOf(fp, names) === "B.Cu" ? "B" : "F";
    const attrs = new Set(atoms(child(fp, "attr")));

    const props: Record<string, string> = {};
    for (const p of children(fp, "property")) {
        const name = atom(p, 0);
        const value = atom(p, 1);
        if (!name || value === undefined || BORING_PROPS.has(name) || name.startsWith("ki_")) continue;
        if (value === "" || value === "~") continue;
        props[name] = value;
    }

    const fab = emptyBox();
    const crt = emptyBox();
    const silk = emptyBox();
    for (const g of fp.items) {
        if (!isList(g) || !GRAPHIC_HEADS.has(g.head)) continue;
        const layer = layerOf(g, names);
        const lines = shapeLines(g);
        if (layer === "Edge.Cuts") {
            for (const l of lines) edges.push(placePoints(l, x, y, rot));
            continue;
        }
        const target = layer.endsWith(".Fab")
            ? fab
            : layer.endsWith(".CrtYd")
              ? crt
              : layer.endsWith(".SilkS")
                ? silk
                : null;
        if (target) for (const l of lines) addPoints(target, l);
    }

    const pads = children(fp, "pad").map((p) => parsePad(p, rot, names));
    const padBox = emptyBox();
    for (const pad of pads) addPoints(padBox, padCorners(pad));

    // The body outline: the fabrication layer drawing when there is one,
    // else the courtyard pulled in by its usual clearance, else the
    // silkscreen, else the pads.
    const big = (b: BBox) => boxValid(b) && boxWidth(b) > 0.05 && boxHeight(b) > 0.05;
    let body = emptyBox();
    let bodyFrom: BodySource = "none";
    if (big(fab)) {
        body = fab;
        bodyFrom = "fab";
    } else if (big(crt)) {
        const shrunk = inflate(crt, -0.2);
        body = big(shrunk) ? shrunk : crt;
        bodyFrom = "courtyard";
    } else if (big(silk)) {
        body = silk;
        bodyFrom = "silk";
    } else if (boxValid(padBox)) {
        body = inflate(padBox, 0.1);
        bodyFrom = "pads";
    }
    const extent = emptyBox();
    addBox(extent, body);
    addBox(extent, padBox);

    return {
        id,
        ref: textOf(fp, "reference") ?? "",
        value: textOf(fp, "value") ?? "",
        lib: atom(fp, 0) ?? "",
        descr: atom(child(fp, "descr"), 0) ?? "",
        props,
        x,
        y,
        rot,
        side,
        body,
        bodyFrom,
        extent,
        pads,
        smd: attrs.has("smd"),
        dnp: attrs.has("dnp"),
        noBom: attrs.has("exclude_from_bom") || attrs.has("virtual"),
        noPos: attrs.has("exclude_from_pos_files") || attrs.has("virtual"),
        boardOnly: attrs.has("board_only"),
    };
}

// Board-frame bounding box of a footprint's local box.
export function worldBox(fp: Footprint, local: BBox = fp.extent): BBox {
    const b = emptyBox();
    if (!boxValid(local)) {
        addPoint(b, fp.x, fp.y);
        return b;
    }
    addPoints(b, placePoints([local.x0, local.y0, local.x1, local.y0, local.x1, local.y1, local.x0, local.y1], fp.x, fp.y, fp.rot));
    return b;
}

// Map a board point into a footprint's local frame.
export function toLocal(fp: Footprint, bx: number, by: number): [number, number] {
    return rotate(bx - fp.x, by - fp.y, -fp.rot);
}

export function parseBoard(text: string): Board {
    let root: SList;
    try {
        root = parseSexpr(text, { skip });
    } catch (e) {
        throw new BoardError(`not a KiCad board file (${(e as Error).message})`);
    }
    if (root.head !== "kicad_pcb") {
        throw new BoardError(`not a KiCad board file (starts with "${root.head.slice(0, 40)}")`);
    }
    const version = num(child(root, "version"), 0);
    const names = layerNames(root, version);
    const edges: number[][] = [];
    const footprints: Footprint[] = [];
    for (const it of root.items) {
        if (!isList(it)) continue;
        if (it.head === "footprint" || it.head === "module") {
            footprints.push(parseFootprint(it, footprints.length, edges, names));
        } else if (it.head.startsWith("gr_") && layerOf(it, names) === "Edge.Cuts") {
            edges.push(...shapeLines(it));
        }
    }
    const { closed, open } = chainPolylines(edges);
    const bounds = emptyBox();
    for (const l of closed) addPoints(bounds, l);
    for (const l of open) addPoints(bounds, l);
    for (const fp of footprints) addBox(bounds, worldBox(fp));
    return {
        version,
        generator: atom(child(root, "generator"), 0) ?? atom(child(root, "host"), 0) ?? "",
        title: atom(child(child(root, "title_block"), "title"), 0) ?? "",
        footprints,
        outline: closed,
        outlineOpen: open,
        bounds,
    };
}
