// Checks a parsed board against the JSON that scripts/kicad_truth.py dumps
// from KiCad's own pcbnew for the same file.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { normDeg, rotate } from "../src/geometry";
import { parseBoard, type Board } from "../src/kicad";

export interface TruthPad {
    num: string;
    x: number;
    y: number;
    rot: number;
    w: number;
    h: number;
}

export interface TruthFp {
    ref: string;
    value: string;
    lib: string;
    x: number;
    y: number;
    rot: number;
    side: "F" | "B";
    dnp: boolean;
    noBom: boolean;
    boardOnly: boolean;
    pads: TruthPad[];
}

export interface TruthEdge {
    type: string;
    sx?: number;
    sy?: number;
    mx?: number;
    my?: number;
    ex?: number;
    ey?: number;
    cx?: number;
    cy?: number;
    r?: number;
}

// Angle difference modulo `period` degrees, in [0, period/2].
export function angleDiff(a: number, b: number, period = 360): number {
    const d = normDeg(a - b) % period;
    return Math.min(d, period - d);
}

// Distance from (px, py) to the nearest segment of the board outline.
export function distToOutline(board: Board, px: number, py: number): number {
    let best = Infinity;
    for (const l of [...board.outline, ...board.outlineOpen]) {
        for (let i = 0; i + 3 < l.length; i += 2) {
            const ax = l[i]!;
            const ay = l[i + 1]!;
            const bx = l[i + 2]!;
            const by = l[i + 3]!;
            const dx = bx - ax;
            const dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
            best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
        }
    }
    return best;
}

export function checkAgainstTruth(board: Board, truth: { footprints: TruthFp[]; edges: TruthEdge[] }): void {
    expect(board.footprints.length).toBe(truth.footprints.length);
    // pcbnew keeps the file order of footprints and pads.
    truth.footprints.forEach((t, i) => {
        const fp = board.footprints[i]!;
        const where = `${t.ref} (#${i})`;
        expect(fp.ref, where).toBe(t.ref);
        expect(fp.value, where).toBe(t.value);
        expect(fp.side, where).toBe(t.side);
        expect(Math.abs(fp.x - t.x), where).toBeLessThan(1e-4);
        expect(Math.abs(fp.y - t.y), where).toBeLessThan(1e-4);
        expect(angleDiff(fp.rot, t.rot), where).toBeLessThan(1e-3);
        expect(fp.dnp, where).toBe(t.dnp);
        expect(fp.boardOnly, where).toBe(t.boardOnly);
        expect(fp.pads.length, where).toBe(t.pads.length);
        t.pads.forEach((tp, j) => {
            const pad = fp.pads[j]!;
            const pw = `${where} pad ${tp.num}`;
            const [rx, ry] = rotate(pad.x, pad.y, fp.rot);
            expect(pad.num, pw).toBe(tp.num);
            expect(Math.abs(fp.x + rx - tp.x), pw).toBeLessThan(1e-3);
            expect(Math.abs(fp.y + ry - tp.y), pw).toBeLessThan(1e-3);
            // A pad looks the same turned half a turn.
            expect(angleDiff(fp.rot + pad.rot, tp.rot, 180), pw).toBeLessThan(1e-2);
            expect(Math.abs(pad.w - tp.w), pw).toBeLessThan(1e-3);
            expect(Math.abs(pad.h - tp.h), pw).toBeLessThan(1e-3);
        });
    });
    for (const e of truth.edges) {
        const pts: [number, number][] = [];
        if (e.type === "Circle") pts.push([e.cx! + e.r!, e.cy!], [e.cx!, e.cy! - e.r!]);
        else pts.push([e.sx!, e.sy!], [e.ex!, e.ey!]);
        if (e.type === "Arc") pts.push([e.mx!, e.my!]);
        for (const [px, py] of pts) {
            expect(distToOutline(board, px, py), `${e.type} edge point ${px},${py}`).toBeLessThan(0.02);
        }
    }
}


// Parse `<name>.kicad_pcb` and check it against `<name>.truth.json`.
export function checkFile(boardPath: string): Board {
    const truth = JSON.parse(readFileSync(boardPath.replace(/\.kicad_pcb$/, ".truth.json"), "utf8"));
    const board = parseBoard(readFileSync(boardPath, "utf8"));
    checkAgainstTruth(board, truth);
    return board;
}
