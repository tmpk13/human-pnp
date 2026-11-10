// Plane geometry in KiCad's board frame: millimeters, X to the right,
// Y downward (as on screen). KiCad angles are degrees counterclockwise as
// seen on screen, which with Y downward is the negative math direction.

export interface BBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export function emptyBox(): BBox {
    return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function boxValid(b: BBox): boolean {
    return b.x0 <= b.x1 && b.y0 <= b.y1;
}

export function addPoint(b: BBox, x: number, y: number): void {
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
}

export function addBox(b: BBox, o: BBox): void {
    if (!boxValid(o)) return;
    addPoint(b, o.x0, o.y0);
    addPoint(b, o.x1, o.y1);
}

export function boxWidth(b: BBox): number {
    return b.x1 - b.x0;
}

export function boxHeight(b: BBox): number {
    return b.y1 - b.y0;
}

export function inflate(b: BBox, d: number): BBox {
    return { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d };
}

// Rotate (x, y) by a KiCad angle (degrees, counterclockwise on screen).
export function rotate(x: number, y: number, deg: number): [number, number] {
    if (deg === 0) return [x, y];
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Snap the common right angles so 90 degrees gives exact results.
    const cs = Math.abs(c) < 1e-12 ? 0 : c;
    const sn = Math.abs(s) < 1e-12 ? 0 : s;
    // Adding 0 turns -0 into 0.
    return [x * cs + y * sn + 0, -x * sn + y * cs + 0];
}

// Normalize degrees into [0, 360).
export function normDeg(d: number): number {
    const r = d % 360;
    return r < 0 ? r + 360 : r;
}

// Largest angle step that keeps a chord within `tol` of a circle of radius r.
function stepFor(r: number, tol: number): number {
    if (r <= tol) return Math.PI / 2;
    return Math.max(2 * Math.acos(1 - tol / r), Math.PI / 90);
}

// Points along the circle around (cx, cy) from angle a0 by `sweep` radians,
// where angles are measured in the Y-down frame (atan2(dy, dx)), so a
// positive sweep turns clockwise on screen. Includes both end points.
export function arcPoints(
    cx: number,
    cy: number,
    r: number,
    a0: number,
    sweep: number,
    tol = 0.01,
): number[] {
    const n = Math.min(256, Math.max(2, Math.ceil(Math.abs(sweep) / stepFor(r, tol))));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
        const a = a0 + (sweep * i) / n;
        pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return pts;
}

export interface Arc {
    cx: number;
    cy: number;
    r: number;
    a0: number; // start angle, Y-down frame, radians
    sweep: number; // signed, radians, positive = clockwise on screen
}

// The arc through start, mid and end (KiCad 6+ form). Null when the three
// points are collinear (a degenerate arc, best drawn as a line).
export function arcFrom3(
    sx: number,
    sy: number,
    mx: number,
    my: number,
    ex: number,
    ey: number,
): Arc | null {
    const d = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my));
    if (Math.abs(d) < 1e-12) return null;
    const s2 = sx * sx + sy * sy;
    const m2 = mx * mx + my * my;
    const e2 = ex * ex + ey * ey;
    const cx = (s2 * (my - ey) + m2 * (ey - sy) + e2 * (sy - my)) / d;
    const cy = (s2 * (ex - mx) + m2 * (sx - ex) + e2 * (mx - sx)) / d;
    const r = Math.hypot(sx - cx, sy - cy);
    const a0 = Math.atan2(sy - cy, sx - cx);
    const am = Math.atan2(my - cy, mx - cx);
    const a1 = Math.atan2(ey - cy, ex - cx);
    const tau = 2 * Math.PI;
    const toMid = (((am - a0) % tau) + tau) % tau;
    const toEnd = (((a1 - a0) % tau) + tau) % tau;
    // Going the positive way, the mid point comes before the end point
    // exactly when the arc runs the positive way.
    const sweep = toMid < toEnd ? toEnd : toEnd - tau;
    return { cx, cy, r, a0, sweep };
}

// A KiCad 4/5 arc: center, start point, and sweep in degrees. A positive
// KiCad 5 sweep turns clockwise on screen (tests/geometry.test.ts checks
// this against pcbnew).
export function arcLegacy(cx: number, cy: number, sx: number, sy: number, angleDeg: number): Arc {
    return {
        cx,
        cy,
        r: Math.hypot(sx - cx, sy - cy),
        a0: Math.atan2(sy - cy, sx - cx),
        sweep: (angleDeg * Math.PI) / 180,
    };
}

export function flattenArc(a: Arc, tol = 0.01): number[] {
    return arcPoints(a.cx, a.cy, a.r, a.a0, a.sweep, tol);
}

// Points along a cubic Bezier curve, both ends included.
export function bezierPoints(p: number[], segments = 16): number[] {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = p as [number, number, number, number, number, number, number, number];
    const out: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
    }
    return out;
}

// Transform a flat point list [x0, y0, x1, y1, ...] by a KiCad rotation
// then a translation.
export function placePoints(pts: number[], dx: number, dy: number, deg: number): number[] {
    const out = new Array<number>(pts.length);
    for (let i = 0; i + 1 < pts.length; i += 2) {
        const [x, y] = rotate(pts[i]!, pts[i + 1]!, deg);
        out[i] = x + dx;
        out[i + 1] = y + dy;
    }
    return out;
}

export function addPoints(b: BBox, pts: number[]): void {
    for (let i = 0; i + 1 < pts.length; i += 2) addPoint(b, pts[i]!, pts[i + 1]!);
}

// Join open polylines whose ends meet (within `eps`) into longer chains,
// so a board outline drawn as separate lines and arcs becomes closed loops
// that can be filled. Chains that never close are returned open.
export function chainPolylines(lines: number[][], eps = 0.01): { closed: number[][]; open: number[][] } {
    const closed: number[][] = [];
    const open: number[][] = [];
    const pool = lines.filter((l) => l.length >= 4).map((l) => l.slice());
    const near = (ax: number, ay: number, bx: number, by: number) =>
        Math.abs(ax - bx) <= eps && Math.abs(ay - by) <= eps;
    while (pool.length) {
        let chain = pool.pop()!;
        let grew = true;
        while (grew) {
            grew = false;
            const hx = chain[0]!;
            const hy = chain[1]!;
            const tx = chain[chain.length - 2]!;
            const ty = chain[chain.length - 1]!;
            if (chain.length >= 6 && near(hx, hy, tx, ty)) break;
            for (let i = 0; i < pool.length; i++) {
                const l = pool[i]!;
                const lx0 = l[0]!;
                const ly0 = l[1]!;
                const lx1 = l[l.length - 2]!;
                const ly1 = l[l.length - 1]!;
                let next: number[] | null = null;
                if (near(tx, ty, lx0, ly0)) next = chain.concat(l.slice(2));
                else if (near(tx, ty, lx1, ly1)) next = chain.concat(reversePoints(l).slice(2));
                else if (near(hx, hy, lx1, ly1)) next = l.concat(chain.slice(2));
                else if (near(hx, hy, lx0, ly0)) next = reversePoints(l).concat(chain.slice(2));
                if (next) {
                    chain = next;
                    pool.splice(i, 1);
                    grew = true;
                    break;
                }
            }
        }
        const isClosed =
            chain.length >= 6 &&
            near(chain[0]!, chain[1]!, chain[chain.length - 2]!, chain[chain.length - 1]!);
        (isClosed ? closed : open).push(chain);
    }
    return { closed, open };
}

export function reversePoints(pts: number[]): number[] {
    const out: number[] = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i]!, pts[i + 1]!);
    return out;
}
