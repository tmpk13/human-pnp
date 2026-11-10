import { describe, expect, test } from "bun:test";
import { arcFrom3, arcLegacy, chainPolylines, flattenArc, normDeg, rotate } from "../src/geometry";

describe("rotate", () => {
    test("turns counterclockwise on screen (Y down) for positive angles", () => {
        // (1, 0) is to the right; a quarter turn counterclockwise points up,
        // which is negative Y on screen.
        expect(rotate(1, 0, 90)).toEqual([0, -1]);
        expect(rotate(0, -1, 90)).toEqual([-1, 0]);
        const [x, y] = rotate(1, 0, 45);
        expect(x).toBeCloseTo(Math.SQRT1_2, 12);
        expect(y).toBeCloseTo(-Math.SQRT1_2, 12);
    });

    test("normDeg wraps into [0, 360)", () => {
        expect(normDeg(-90)).toBe(270);
        expect(normDeg(720)).toBe(0);
    });
});

describe("arcs", () => {
    test("three-point arc keeps its direction through the mid point", () => {
        // Quarter circle from the top to the right of the origin, through
        // the upper right: clockwise on screen, positive sweep.
        const s = Math.SQRT1_2;
        const cw = arcFrom3(0, -1, s, -s, 1, 0)!;
        expect(cw.cx).toBeCloseTo(0, 9);
        expect(cw.cy).toBeCloseTo(0, 9);
        expect(cw.r).toBeCloseTo(1, 9);
        expect(cw.sweep).toBeCloseTo(Math.PI / 2, 9);
        // Same ends the long way round, through the lower left.
        const ccw = arcFrom3(0, -1, -s, s, 1, 0)!;
        expect(ccw.sweep).toBeCloseTo((-3 * Math.PI) / 2, 9);
    });

    test("collinear points are not an arc", () => {
        expect(arcFrom3(0, 0, 1, 1, 2, 2)).toBeNull();
    });

    test("legacy arcs end where KiCad 5 puts them", () => {
        // From pcbnew on tests/data/legacy-k5.kicad_pcb: center (127, 103),
        // start (127, 100), angle 90 ends at (130, 103).
        const pts = flattenArc(arcLegacy(127, 103, 127, 100, 90));
        expect(pts[pts.length - 2]!).toBeCloseTo(130, 9);
        expect(pts[pts.length - 1]!).toBeCloseTo(103, 9);
    });
});

describe("chainPolylines", () => {
    test("joins pieces in any order and direction into a closed loop", () => {
        const { closed, open } = chainPolylines([
            [0, 0, 10, 0],
            [10, 5, 10, 0], // reversed
            [0, 5, 0, 0],
            [10, 5, 0, 5],
        ]);
        expect(open).toEqual([]);
        expect(closed.length).toBe(1);
        expect(closed[0]!.length).toBe(10);
    });

    test("leaves unconnected pieces open", () => {
        const { closed, open } = chainPolylines([
            [0, 0, 1, 0],
            [5, 5, 6, 6],
        ]);
        expect(closed).toEqual([]);
        expect(open.length).toBe(2);
    });
});
