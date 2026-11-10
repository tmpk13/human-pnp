// The board drawing: a canvas showing one side of the board with part
// outlines, pads, symbols and reference/value labels, which pans and zooms
// by touch, mouse and wheel, and reports taps on parts.
//
// World coordinates are KiCad's (millimeters, Y down). The screen maps a
// world point to (m * s * x + ox, s * y + oy) in CSS pixels, with m = -1 for
// the back side so the board looks as it does when turned over.
//
// Geometry that does not change is built once per side into a few Path2D
// batches (pads, outlines, symbols by size), so a frame is a handful of
// fill and stroke calls even for boards with thousands of pads. Labels are
// drawn in screen space each frame so they never mirror and can skip each
// other when crowded.

import { boxValid, emptyBox, addBox, type BBox } from "./geometry";
import { toLocal, worldBox, type Board, type Pad, type Side } from "./kicad";
import type { Kind } from "./classify";
import type { Part } from "./parts";
import { SYMBOLS } from "./symbols";

export interface Palette {
    bg: string;
    board: string;
    edge: string;
    part: string;
    partEdge: string;
    pad: string;
    pad1: string;
    symbol: string;
    ref: string;
    value: string;
    hl: string;
    focus: string;
    search: string;
    placed: string;
    dnp: string;
    labelBg: string;
}

export interface ViewState {
    // Parts with the selected value.
    highlight: Set<Part>;
    // The part tapped last.
    focus: Part | null;
    // Search hits; null when no search is active.
    search: Set<Part> | null;
    // References marked as placed.
    placed: Set<string>;
    showPads: boolean;
    showLabels: boolean;
}

interface PartGeom {
    part: Part;
    // Outline, symbol and pin 1 dot in world coordinates.
    body: Path2D;
    symbol: Path2D | null;
    pin1: Path2D | null;
    // A cross over the outline, for DNP parts.
    cross: Path2D;
    // A tick inside the outline, for placed parts.
    tick: Path2D;
    // World corners of the outline (x0, y0, ..., x3, y3).
    corners: number[];
    // World corners of outline and pads together.
    extCorners: number[];
    // World bounding box of outline and pads.
    wbox: BBox;
    bodyW: number;
    bodyH: number;
    // Symbol scale (mm per symbol unit), for level of detail.
    symScale: number;
}

interface Layer {
    pads: Path2D;
    pad1: Path2D;
    holes: Path2D;
    bodies: Path2D;
    others: Path2D;
    // Symbols grouped by size: bucket b holds symbols whose scale is in
    // [2^b, 2^(b+1)) mm.
    symbols: Map<number, Path2D>;
    parts: PartGeom[];
}

// Parts that work either way round: their pad 1 is not marked.
const NON_POLAR = new Set<Kind>([
    "resistor",
    "capacitor",
    "inductor",
    "ferrite",
    "fuse",
    "jumper",
    "thermistor",
    "testpoint",
    "mounting_hole",
    "fiducial",
    "logo",
]);

const MIN_SYMBOL_PX = 9;
const MIN_LABEL_PX = 7;
const MAX_SCALE = 600;

function roundRect(p: Path2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (rr <= 0) {
        p.rect(x, y, w, h);
        return;
    }
    p.moveTo(x + rr, y);
    p.arcTo(x + w, y, x + w, y + h, rr);
    p.arcTo(x + w, y + h, x, y + h, rr);
    p.arcTo(x, y + h, x, y, rr);
    p.arcTo(x, y, x + w, y, rr);
    p.closePath();
}

function padShape(pad: Pad): Path2D {
    const p = new Path2D();
    const { w, h } = pad;
    switch (pad.shape) {
        case "circle":
            p.arc(0, 0, w / 2, 0, 2 * Math.PI);
            break;
        case "oval":
            roundRect(p, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
            break;
        case "roundrect":
            roundRect(p, -w / 2, -h / 2, w, h, Math.min(w, h) * pad.rratio);
            break;
        default:
            p.rect(-w / 2, -h / 2, w, h);
    }
    for (const poly of pad.poly ?? []) {
        for (let i = 0; i + 1 < poly.length; i += 2) {
            if (i === 0) p.moveTo(poly[0]!, poly[1]!);
            else p.lineTo(poly[i]!, poly[i + 1]!);
        }
        p.closePath();
    }
    return p;
}

function holeShape(pad: Pad): Path2D {
    const p = new Path2D();
    const w = pad.drillW;
    const h = pad.drillH || w;
    if (Math.abs(w - h) < 1e-6) p.arc(0, 0, w / 2, 0, 2 * Math.PI);
    else roundRect(p, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
    return p;
}

// Pin 1 and pin 2 of a two-terminal part, or null when the part does not
// have exactly two numbered pads in different places.
function pinPair(pads: Pad[]): [Pad, Pad] | null {
    const numbered = pads.filter((p) => p.num !== "");
    const names = new Set(numbered.map((p) => p.num));
    if (names.size !== 2) return null;
    const find = (opts: string[]) => numbered.find((p) => opts.includes(p.num));
    const p1 = find(["1", "K", "+"]) ?? numbered[0]!;
    const p2 = numbered.find((p) => p.num !== p1.num)!;
    if (Math.abs(p1.x - p2.x) < 1e-6 && Math.abs(p1.y - p2.y) < 1e-6) return null;
    return [p1, p2];
}

function bucketOf(scale: number): number {
    return Math.max(-6, Math.min(6, Math.floor(Math.log2(Math.max(scale, 1e-6)))));
}

function buildPart(part: Part): PartGeom {
    const fp = part.fp;
    const base = new DOMMatrix().translateSelf(fp.x, fp.y).rotateSelf(-fp.rot);
    let b = fp.body;
    if (!boxValid(b)) b = { x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 };
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;

    const local = new Path2D();
    roundRect(local, b.x0, b.y0, w, h, Math.min(w, h) * 0.18);
    const body = new Path2D();
    body.addPath(local, base);

    // Symbol: two-terminal symbols point from pad 1 to pad 2; others sit
    // upright in the footprint's frame, turned a quarter when the outline
    // is taller than wide and the symbol wider than tall.
    const def = SYMBOLS[part.kind];
    let angle = 0;
    let along = w;
    let across = h;
    let fill = 0.5;
    const pins = def.twoPin ? pinPair(fp.pads) : null;
    if (pins) {
        const [p1, p2] = pins;
        const a = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        angle = (a * 180) / Math.PI;
        if (Math.abs(Math.cos(a)) < Math.abs(Math.sin(a))) {
            along = h;
            across = w;
        }
        fill = 0.86;
    } else if (def.w > def.h && h > w * 1.2) {
        angle = 90;
        along = h;
        across = w;
    }
    const s = Math.min((along * fill) / def.w, (across * fill) / def.h);
    let symbol: Path2D | null = null;
    if (def.d && s > 0) {
        symbol = new Path2D();
        symbol.addPath(new Path2D(def.d), base.translate(cx, cy).rotate(angle).scale(s));
    }

    // Pin 1 dot for parts with three or more pads: in the outline's corner
    // nearest pad 1.
    let pin1: Path2D | null = null;
    const numbered = fp.pads.filter((p) => p.num !== "");
    const first = numbered.find((p) => p.num === "1" || p.num === "A1");
    if (first && new Set(numbered.map((p) => p.num)).size >= 3) {
        const m = Math.min(w, h);
        const inset = m * 0.16;
        const r = Math.max(0.08, Math.min(0.35, m * 0.05));
        const px = first.x < cx - 1e-6 ? b.x0 + inset : first.x > cx + 1e-6 ? b.x1 - inset : b.x0 + inset;
        const py = first.y < cy - 1e-6 ? b.y0 + inset : first.y > cy + 1e-6 ? b.y1 - inset : b.y0 + inset;
        const dot = new Path2D();
        dot.arc(px, py, r, 0, 2 * Math.PI);
        pin1 = new Path2D();
        pin1.addPath(dot, base);
    }

    const crossLocal = new Path2D();
    crossLocal.moveTo(b.x0, b.y0);
    crossLocal.lineTo(b.x1, b.y1);
    crossLocal.moveTo(b.x0, b.y1);
    crossLocal.lineTo(b.x1, b.y0);
    const cross = new Path2D();
    cross.addPath(crossLocal, base);

    const t = Math.min(w, h) * 0.32;
    const tickLocal = new Path2D();
    tickLocal.moveTo(cx - t, cy);
    tickLocal.lineTo(cx - t * 0.3, cy + t * 0.7);
    tickLocal.lineTo(cx + t, cy - t * 0.7);
    const tick = new Path2D();
    tick.addPath(tickLocal, base);

    const cornersOf = (r: BBox) => {
        const out: number[] = [];
        for (const [x, y] of [
            [r.x0, r.y0],
            [r.x1, r.y0],
            [r.x1, r.y1],
            [r.x0, r.y1],
        ] as [number, number][]) {
            const pt = base.transformPoint({ x, y });
            out.push(pt.x, pt.y);
        }
        return out;
    };
    const corners = cornersOf(b);
    const extCorners = boxValid(fp.extent) ? cornersOf(fp.extent) : corners;
    return {
        part,
        body,
        symbol,
        pin1,
        cross,
        tick,
        corners,
        extCorners,
        wbox: worldBox(fp),
        bodyW: w,
        bodyH: h,
        symScale: s,
    };
}

function buildLayers(board: Board, parts: Part[]): Record<Side, Layer> {
    const make = (): Layer => ({
        pads: new Path2D(),
        pad1: new Path2D(),
        holes: new Path2D(),
        bodies: new Path2D(),
        others: new Path2D(),
        symbols: new Map(),
        parts: [],
    });
    const layers: Record<Side, Layer> = { F: make(), B: make() };
    const shapes = new Map<string, Path2D>();
    for (const part of parts) {
        const fp = part.fp;
        const base = new DOMMatrix().translateSelf(fp.x, fp.y).rotateSelf(-fp.rot);
        for (const pad of fp.pads) {
            const m = base.translate(pad.x, pad.y).rotate(-pad.rot);
            if (pad.w > 0 && pad.h > 0 && (pad.front || pad.back)) {
                const key = `${pad.shape}|${pad.w}|${pad.h}|${pad.rratio}`;
                let shape = pad.poly ? padShape(pad) : shapes.get(key);
                if (!shape) {
                    shape = padShape(pad);
                    shapes.set(key, shape);
                }
                const isPin1 = pad.num === "1" && fp.pads.length > 1 && !NON_POLAR.has(part.kind);
                if (pad.front) (isPin1 ? layers.F.pad1 : layers.F.pads).addPath(shape, m);
                if (pad.back) (isPin1 ? layers.B.pad1 : layers.B.pads).addPath(shape, m);
            }
            if (pad.drillW > 0) {
                const hole = holeShape(pad);
                layers.F.holes.addPath(hole, m);
                layers.B.holes.addPath(hole, m);
            }
        }
        if (part.kind === "mounting_hole" || part.kind === "fiducial" || part.kind === "logo") continue;
        const g = buildPart(part);
        const layer = layers[fp.side];
        layer.parts.push(g);
        if (!part.placeable) {
            layer.others.addPath(g.body);
            continue;
        }
        layer.bodies.addPath(g.body);
        if (g.symbol) {
            const bucket = bucketOf(g.symScale);
            let path = layer.symbols.get(bucket);
            if (!path) {
                path = new Path2D();
                layer.symbols.set(bucket, path);
            }
            path.addPath(g.symbol);
        }
    }
    return layers;
}

function outlinePath(board: Board): Path2D {
    const p = new Path2D();
    for (const loop of [...board.outline, ...board.outlineOpen]) {
        for (let i = 0; i + 1 < loop.length; i += 2) {
            if (i === 0) p.moveTo(loop[0]!, loop[1]!);
            else p.lineTo(loop[i]!, loop[i + 1]!);
        }
    }
    return p;
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export class BoardView {
    readonly canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private board: Board;
    private layers: Record<Side, Layer>;
    private outline: Path2D;
    private boardFill: Path2D;
    side: Side = "F";
    private s = 1;
    private ox = 0;
    private oy = 0;
    private cssW = 0;
    private cssH = 0;
    private dpr = 1;
    private fitted = false;
    private frame = 0;
    private anim = 0;
    private widths = new Map<string, number>();
    palette: Palette;
    state: ViewState;
    // Pixels at the bottom covered by the parts list.
    bottomInset: () => number = () => 0;
    onTap: (part: Part | null) => void = () => {};

    private observer: ResizeObserver;
    private pointers = new Map<number, { x: number; y: number }>();
    private pan: { x: number; y: number; ox: number; oy: number; moved: boolean; t: number } | null = null;
    private pinch: { d: number; s: number; wx: number; wy: number } | null = null;

    constructor(canvas: HTMLCanvasElement, board: Board, parts: Part[], palette: Palette, state: ViewState) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas");
        this.ctx = ctx;
        this.board = board;
        this.palette = palette;
        this.state = state;
        this.layers = buildLayers(board, parts);
        this.outline = outlinePath(board);
        this.boardFill = new Path2D();
        for (const loop of board.outline) {
            for (let i = 0; i + 1 < loop.length; i += 2) {
                if (i === 0) this.boardFill.moveTo(loop[0]!, loop[1]!);
                else this.boardFill.lineTo(loop[i]!, loop[i + 1]!);
            }
            this.boardFill.closePath();
        }
        this.bindInput();
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas);
    }

    destroy(): void {
        this.observer.disconnect();
        cancelAnimationFrame(this.frame);
        cancelAnimationFrame(this.anim);
    }

    // --- Transform ------------------------------------------------------

    private get m(): number {
        return this.side === "B" ? -1 : 1;
    }

    toScreen(x: number, y: number): [number, number] {
        return [this.m * this.s * x + this.ox, this.s * y + this.oy];
    }

    toWorld(sx: number, sy: number): [number, number] {
        return [(sx - this.ox) / (this.m * this.s), (sy - this.oy) / this.s];
    }

    // The part of the canvas not covered by the parts list.
    private visibleRect(): Rect {
        const bottom = Math.min(this.bottomInset(), this.cssH * 0.9);
        return { x: 0, y: 0, w: this.cssW, h: Math.max(1, this.cssH - bottom) };
    }

    private transformFor(box: BBox, margin = 0.08): { s: number; ox: number; oy: number } {
        const r = this.visibleRect();
        const bw = Math.max(box.x1 - box.x0, 1e-3);
        const bh = Math.max(box.y1 - box.y0, 1e-3);
        const s = Math.min((r.w * (1 - 2 * margin)) / bw, (r.h * (1 - 2 * margin)) / bh, MAX_SCALE);
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2;
        return { s, ox: r.x + r.w / 2 - this.m * s * cx, oy: r.y + r.h / 2 - s * cy };
    }

    private minScale(): number {
        return this.transformFor(this.board.bounds).s * 0.4;
    }

    fit(animate = false): void {
        if (!boxValid(this.board.bounds)) return;
        this.go(this.transformFor(this.board.bounds), animate);
    }

    // Bring parts into view: no change when they are all on screen already,
    // else fit them (at least a 12 mm square, so one part keeps context).
    showParts(parts: Part[]): void {
        const box = emptyBox();
        const r = this.visibleRect();
        let allVisible = parts.length > 0;
        for (const p of parts) {
            const wb = worldBox(p.fp);
            addBox(box, wb);
            const [ax, ay] = this.toScreen(wb.x0, wb.y0);
            const [bx, by] = this.toScreen(wb.x1, wb.y1);
            const inside =
                Math.min(ax, bx) >= r.x && Math.max(ax, bx) <= r.x + r.w && Math.min(ay, by) >= r.y && Math.max(ay, by) <= r.y + r.h;
            if (!inside) allVisible = false;
        }
        if (allVisible || !boxValid(box)) return;
        const grow = (lo: number, hi: number): [number, number] => {
            const need = Math.max(0, 12 - (hi - lo)) / 2;
            return [lo - need, hi + need];
        };
        const [x0, x1] = grow(box.x0, box.x1);
        const [y0, y1] = grow(box.y0, box.y1);
        this.go(this.transformFor({ x0, y0, x1, y1 }, 0.1), true);
    }

    private go(t: { s: number; ox: number; oy: number }, animate: boolean): void {
        cancelAnimationFrame(this.anim);
        if (!animate || !this.fitted) {
            this.s = t.s;
            this.ox = t.ox;
            this.oy = t.oy;
            this.redraw();
            return;
        }
        const r = this.visibleRect();
        const vx = r.x + r.w / 2;
        const vy = r.y + r.h / 2;
        const [c0x, c0y] = this.toWorld(vx, vy);
        const s0 = this.s;
        const c1x = (vx - t.ox) / (this.m * t.s);
        const c1y = (vy - t.oy) / t.s;
        const start = performance.now();
        const step = (now: number) => {
            const k = Math.min(1, (now - start) / 240);
            const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
            this.s = s0 * (t.s / s0) ** e;
            const cx = c0x + (c1x - c0x) * e;
            const cy = c0y + (c1y - c0y) * e;
            this.ox = vx - this.m * this.s * cx;
            this.oy = vy - this.s * cy;
            this.draw();
            if (k < 1) this.anim = requestAnimationFrame(step);
        };
        this.anim = requestAnimationFrame(step);
    }

    setSide(side: Side): void {
        if (side === this.side) return;
        const r = this.visibleRect();
        const [wx, wy] = this.toWorld(r.x + r.w / 2, r.y + r.h / 2);
        this.side = side;
        this.ox = r.x + r.w / 2 - this.m * this.s * wx;
        this.oy = r.y + r.h / 2 - this.s * wy;
        this.redraw();
    }

    zoomAt(sx: number, sy: number, factor: number): void {
        cancelAnimationFrame(this.anim);
        const [wx, wy] = this.toWorld(sx, sy);
        this.s = Math.max(this.minScale(), Math.min(MAX_SCALE, this.s * factor));
        this.ox = sx - this.m * this.s * wx;
        this.oy = sy - this.s * wy;
        this.redraw();
    }

    // Screen position (CSS pixels) of a part's center, or null when it is
    // on the other side; for tests and debugging.
    screenPosOf(ref: string): [number, number] | null {
        const g = this.layers[this.side].parts.find((p) => p.part.fp.ref === ref);
        if (!g) return null;
        const c = g.corners;
        return this.toScreen((c[0]! + c[4]!) / 2, (c[1]! + c[5]!) / 2);
    }

    // --- Input ------------------------------------------------------------

    private bindInput(): void {
        const c = this.canvas;
        c.addEventListener("pointerdown", (e) => {
            c.setPointerCapture(e.pointerId);
            cancelAnimationFrame(this.anim);
            this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
            if (this.pointers.size === 1) {
                this.pan = { x: e.offsetX, y: e.offsetY, ox: this.ox, oy: this.oy, moved: false, t: performance.now() };
            } else if (this.pointers.size === 2) {
                this.startPinch();
            }
        });
        c.addEventListener("pointermove", (e) => {
            const p = this.pointers.get(e.pointerId);
            if (!p) return;
            p.x = e.offsetX;
            p.y = e.offsetY;
            if (this.pointers.size >= 2 && this.pinch) {
                const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                this.s = Math.max(this.minScale(), Math.min(MAX_SCALE, (this.pinch.s * d) / Math.max(this.pinch.d, 1)));
                this.ox = mx - this.m * this.s * this.pinch.wx;
                this.oy = my - this.s * this.pinch.wy;
                this.redraw();
            } else if (this.pan) {
                const dx = e.offsetX - this.pan.x;
                const dy = e.offsetY - this.pan.y;
                if (!this.pan.moved && Math.hypot(dx, dy) > 6) this.pan.moved = true;
                if (this.pan.moved) {
                    this.ox = this.pan.ox + dx;
                    this.oy = this.pan.oy + dy;
                    this.redraw();
                }
            }
        });
        const end = (e: PointerEvent) => {
            if (!this.pointers.has(e.pointerId)) return;
            const wasPinch = this.pointers.size >= 2;
            this.pointers.delete(e.pointerId);
            if (wasPinch) {
                this.pinch = null;
                // Keep panning with the finger that stays, from where it is.
                const rest = [...this.pointers.values()][0];
                this.pan = rest ? { x: rest.x, y: rest.y, ox: this.ox, oy: this.oy, moved: true, t: 0 } : null;
                return;
            }
            const pan = this.pan;
            this.pan = null;
            if (e.type === "pointerup" && pan && !pan.moved && performance.now() - pan.t < 700) {
                this.onTap(this.partAt(e.offsetX, e.offsetY));
            }
        };
        c.addEventListener("pointerup", end);
        c.addEventListener("pointercancel", end);
        c.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.cssH : 1;
                const k = e.ctrlKey ? 0.01 : 0.0015;
                this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * unit * k));
            },
            { passive: false },
        );
    }

    private startPinch(): void {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const [wx, wy] = this.toWorld(mx, my);
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.s, wx, wy };
        if (this.pan) this.pan.moved = true;
    }

    // The smallest listed part under a screen point on the shown side.
    partAt(sx: number, sy: number): Part | null {
        const [wx, wy] = this.toWorld(sx, sy);
        const tol = 6 / this.s;
        let best: Part | null = null;
        let bestArea = Infinity;
        for (const g of this.layers[this.side].parts) {
            if (!g.part.placeable) continue;
            const wb = g.wbox;
            if (wx < wb.x0 - tol || wx > wb.x1 + tol || wy < wb.y0 - tol || wy > wb.y1 + tol) continue;
            const e = g.part.fp.extent;
            const [lx, ly] = toLocal(g.part.fp, wx, wy);
            if (lx < e.x0 - tol || lx > e.x1 + tol || ly < e.y0 - tol || ly > e.y1 + tol) continue;
            const area = (e.x1 - e.x0) * (e.y1 - e.y0);
            if (area < bestArea) {
                best = g.part;
                bestArea = area;
            }
        }
        return best;
    }

    // --- Drawing ------------------------------------------------------------

    private resize(): void {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w <= 0 || h <= 0) return;
        this.dpr = Math.min(window.devicePixelRatio || 1, 3);
        const pw = Math.round(w * this.dpr);
        const ph = Math.round(h * this.dpr);
        if (this.canvas.width !== pw || this.canvas.height !== ph) {
            this.canvas.width = pw;
            this.canvas.height = ph;
        }
        this.cssW = w;
        this.cssH = h;
        // Fit once the canvas has a real size (it is 0 x 0 before layout).
        if (!this.fitted) {
            this.fit();
            this.fitted = true;
        }
        this.draw();
    }

    redraw(): void {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.draw();
        });
    }

    draw(): void {
        const ctx = this.ctx;
        const p = this.palette;
        const st = this.state;
        const dpr = this.dpr;
        const px = 1 / this.s;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = p.bg;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (!this.cssW) return;
        ctx.setTransform(dpr * this.m * this.s, 0, 0, dpr * this.s, dpr * this.ox, dpr * this.oy);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        ctx.fillStyle = p.board;
        ctx.fill(this.boardFill, "evenodd");
        ctx.strokeStyle = p.edge;
        ctx.lineWidth = 1.5 * px;
        ctx.stroke(this.outline);

        const layer = this.layers[this.side];
        const dim = st.highlight.size > 0 || st.search !== null;
        const faded = dim ? 0.3 : 1;

        if (st.showPads) {
            ctx.globalAlpha = dim ? 0.35 : 0.75;
            ctx.fillStyle = p.pad;
            ctx.fill(layer.pads);
            ctx.fillStyle = p.pad1;
            ctx.fill(layer.pad1);
            ctx.globalAlpha = 1;
            ctx.fillStyle = p.board;
            ctx.fill(layer.holes);
        }

        ctx.globalAlpha = faded * 0.6;
        ctx.strokeStyle = p.partEdge;
        ctx.lineWidth = px;
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.stroke(layer.others);
        ctx.setLineDash([]);

        ctx.globalAlpha = faded * 0.55;
        ctx.fillStyle = p.part;
        ctx.fill(layer.bodies);
        ctx.globalAlpha = faded;
        ctx.lineWidth = 1.2 * px;
        ctx.stroke(layer.bodies);

        ctx.strokeStyle = p.symbol;
        ctx.lineWidth = 1.3 * px;
        for (const [bucket, path] of layer.symbols) {
            if (2 ** (bucket + 1) * this.s >= MIN_SYMBOL_PX) ctx.stroke(path);
        }

        // Per-part marks: pin 1 dots, DNP crosses, placed ticks.
        const view = this.viewBox();
        const onScreen = layer.parts.filter(
            (g) => g.part.placeable && g.wbox.x1 >= view.x0 && g.wbox.x0 <= view.x1 && g.wbox.y1 >= view.y0 && g.wbox.y0 <= view.y1,
        );
        ctx.fillStyle = p.pad1;
        for (const g of onScreen) {
            if (g.pin1 && Math.min(g.bodyW, g.bodyH) * this.s >= 14) ctx.fill(g.pin1);
        }
        ctx.lineWidth = 1.5 * px;
        for (const g of onScreen) {
            if (g.part.dnp) {
                ctx.strokeStyle = p.dnp;
                ctx.stroke(g.cross);
            } else if (st.placed.has(g.part.fp.ref)) {
                ctx.fillStyle = p.placed;
                ctx.globalAlpha = faded * 0.25;
                ctx.fill(g.body);
                ctx.globalAlpha = faded;
                ctx.strokeStyle = p.placed;
                ctx.lineWidth = 2.5 * px;
                ctx.stroke(g.tick);
                ctx.lineWidth = 1.5 * px;
            }
        }
        ctx.globalAlpha = 1;

        // Highlighted parts on top, at full strength.
        const marked = (g: PartGeom) => st.highlight.has(g.part) || (st.search?.has(g.part) ?? false);
        for (const g of layer.parts) {
            if (!marked(g)) continue;
            const color = st.highlight.has(g.part) ? p.hl : p.search;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.3;
            ctx.lineWidth = 9 * px;
            ctx.stroke(g.body);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.28;
            ctx.fill(g.body);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.2 * px;
            ctx.stroke(g.body);
            if (g.symbol && g.symScale * this.s >= MIN_SYMBOL_PX / 2) {
                ctx.strokeStyle = p.symbol;
                ctx.lineWidth = 1.4 * px;
                ctx.stroke(g.symbol);
            }
            if (st.placed.has(g.part.fp.ref)) {
                ctx.strokeStyle = p.placed;
                ctx.lineWidth = 2.5 * px;
                ctx.stroke(g.tick);
            }
        }
        const focus = st.focus ? layer.parts.find((g) => g.part === st.focus) : undefined;
        if (focus) {
            ctx.strokeStyle = p.focus;
            ctx.lineWidth = 3 * px;
            ctx.stroke(focus.body);
        }

        if (st.showLabels) this.drawLabels(layer, marked, dim);
    }

    // World rectangle the canvas shows.
    private viewBox(): BBox {
        const [ax, ay] = this.toWorld(0, 0);
        const [bx, by] = this.toWorld(this.cssW, this.cssH);
        return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
    }

    private textWidth(text: string, bold: boolean, fontPx: number): number {
        const key = (bold ? "b" : "r") + text;
        let w100 = this.widths.get(key);
        if (w100 === undefined) {
            this.ctx.font = `${bold ? 600 : 400} 100px system-ui, sans-serif`;
            w100 = this.ctx.measureText(text).width;
            this.widths.set(key, w100);
        }
        return (w100 * fontPx) / 100;
    }

    // Reference on one side of each part and value on the other, just
    // outside its outline and pads: above and below a part that is wider
    // than tall on screen, left and right of a tall one, the other pair
    // when that space is taken. Labels avoid other parts and each other;
    // one that does not fit is left out (zooming in makes room), except for
    // highlighted parts, which are labeled first and on a backing.
    private drawLabels(layer: Layer, marked: (g: PartGeom) => boolean, dim: boolean): void {
        const ctx = this.ctx;
        const p = this.palette;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const vb = this.viewBox();
        type Item = { g: PartGeom; important: boolean; short: number; box: Rect };
        const items: Item[] = [];
        const grid = new RectGrid(64);
        for (const g of layer.parts) {
            const wb = g.wbox;
            if (wb.x1 < vb.x0 || wb.x0 > vb.x1 || wb.y1 < vb.y0 || wb.y0 > vb.y1) continue;
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            for (let i = 0; i < 8; i += 2) {
                const [sx, sy] = this.toScreen(g.extCorners[i]!, g.extCorners[i + 1]!);
                x0 = Math.min(x0, sx);
                x1 = Math.max(x1, sx);
                y0 = Math.min(y0, sy);
                y1 = Math.max(y1, sy);
            }
            const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            grid.add(box, g);
            if (!g.part.placeable) continue;
            const important = marked(g) || g.part === this.state.focus;
            const short = Math.min(g.bodyW, g.bodyH) * this.s;
            if (short < MIN_LABEL_PX && !important) continue;
            items.push({ g, important, short, box });
        }
        items.sort((a, b) => Number(b.important) - Number(a.important) || b.short - a.short);
        const gap = 2;
        for (const it of items) {
            const fontPx = Math.max(9, Math.min(15, it.short * 0.6));
            const h = fontPx * 1.15;
            const { box, g } = it;
            const fp = g.part.fp;
            const rw = this.textWidth(fp.ref, true, fontPx);
            const vw = fp.value ? this.textWidth(fp.value, false, fontPx) : 0;
            const cx = box.x + box.w / 2;
            const cy = box.y + box.h / 2;
            const stacked = (): Rect[] => [
                { x: cx - rw / 2, y: box.y - gap - h, w: rw, h },
                { x: cx - vw / 2, y: box.y + box.h + gap, w: vw, h },
            ];
            const sideways = (): Rect[] => [
                { x: box.x - gap - rw, y: cy - h / 2, w: rw, h },
                { x: box.x + box.w + gap, y: cy - h / 2, w: vw, h },
            ];
            const layouts = box.w >= box.h ? [stacked(), sideways()] : [sideways(), stacked()];
            const free = (r: Rect) => r.w === 0 || !grid.hits(r, g);
            let chosen: (Rect | null)[] | null = layouts.find((l) => l.every(free)) ?? null;
            if (!chosen) {
                // No room for both: the reference alone, or both anyway for a
                // highlighted part.
                const refOnly = layouts.find((l) => free(l[0]!));
                chosen = it.important ? layouts[0]! : refOnly ? [refOnly[0]!, null] : null;
            }
            if (!chosen) continue;
            const texts = [fp.ref, fp.value];
            chosen.forEach((r, i) => {
                const text = texts[i]!;
                if (!r || !text) return;
                grid.add(r, g);
                if (it.important) {
                    ctx.globalAlpha = 0.88;
                    ctx.fillStyle = p.labelBg;
                    ctx.beginPath();
                    ctx.roundRect(r.x - 3, r.y, r.w + 6, r.h, h / 3);
                    ctx.fill();
                }
                ctx.globalAlpha = dim && !it.important ? 0.4 : 1;
                ctx.font = `${i === 0 ? 600 : 400} ${fontPx}px system-ui, sans-serif`;
                ctx.fillStyle = i === 0 ? p.ref : p.value;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(text, r.x, r.y + r.h / 2 + fontPx * 0.04);
            });
        }
        ctx.globalAlpha = 1;
    }
}

// Screen rectangles bucketed into square cells, for quick overlap tests.
class RectGrid {
    private cells = new Map<string, { r: Rect; owner: unknown }[]>();
    constructor(private size: number) {}

    private keys(r: Rect): string[] {
        const out: string[] = [];
        const x0 = Math.floor(r.x / this.size);
        const x1 = Math.floor((r.x + r.w) / this.size);
        const y0 = Math.floor(r.y / this.size);
        const y1 = Math.floor((r.y + r.h) / this.size);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x},${y}`);
        return out;
    }

    add(r: Rect, owner: unknown): void {
        for (const k of this.keys(r)) {
            const list = this.cells.get(k);
            if (list) list.push({ r, owner });
            else this.cells.set(k, [{ r, owner }]);
        }
    }

    // Does `r` overlap a rectangle that belongs to someone other than `owner`?
    hits(r: Rect, owner: unknown): boolean {
        for (const k of this.keys(r)) {
            for (const e of this.cells.get(k) ?? []) {
                if (e.owner === owner) continue;
                const b = e.r;
                if (r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h) return true;
            }
        }
        return false;
    }
}
