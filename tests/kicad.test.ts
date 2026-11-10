import { describe, expect, test } from "bun:test";
import { boxHeight, boxWidth } from "../src/geometry";
import { BoardError, parseBoard, toLocal, worldBox } from "../src/kicad";
import { checkFile } from "./truth";

const data = new URL("./data/", import.meta.url).pathname;

describe("hand-written KiCad 5 board", () => {
    const board = checkFile(data + "legacy-k5.kicad_pcb");
    const byRef = new Map(board.footprints.map((f) => [f.ref, f]));

    test("matches pcbnew, including legacy arcs and renamed copper layers", () => {
        expect(board.version).toBe(20171130);
        expect(board.title).toBe("Legacy test board");
        expect(byRef.get("C2")!.side).toBe("B");
        expect(byRef.get("C2")!.pads.every((p) => p.back && !p.front)).toBe(true);
        expect(byRef.get("R1")!.pads.every((p) => p.front && !p.back)).toBe(true);
    });

    test("closes the outline, the round cutout and the slot into loops", () => {
        expect(board.outline.length).toBe(3);
        expect(board.outlineOpen.length).toBe(0);
    });

    test("takes the body from the fab layer, else the courtyard", () => {
        const r1 = byRef.get("R1")!;
        expect(r1.bodyFrom).toBe("fab");
        expect(boxWidth(r1.body)).toBeCloseTo(1.6, 6);
        expect(boxHeight(r1.body)).toBeCloseTo(0.8, 6);
        const r2 = byRef.get("R2")!;
        expect(r2.bodyFrom).toBe("courtyard");
        expect(boxWidth(r2.body)).toBeCloseTo(2.96 - 0.4, 6);
    });

    test("reads drills and flags", () => {
        const j1 = byRef.get("J1")!;
        expect(j1.pads[0]!.drillW).toBe(1);
        expect(j1.pads[1]!.drillW).toBe(0.8);
        expect(j1.pads[1]!.drillH).toBe(1.2);
        expect(j1.pads[0]!.front && j1.pads[0]!.back).toBe(true);
        expect(byRef.get("H1")!.noBom).toBe(true);
        expect(byRef.get("C1")!.value).toBe("1uF 25V");
        expect(byRef.get("R2")!.value).toBe("4K7");
    });

    test("maps board points into a footprint's frame", () => {
        const u1 = byRef.get("U1")!;
        const [lx, ly] = toLocal(u1, u1.x, u1.y);
        expect(lx).toBeCloseTo(0, 9);
        expect(ly).toBeCloseTo(0, 9);
        // A 45 degree part's board box is wider than its body.
        const wb = worldBox(u1, u1.body);
        expect(boxWidth(wb)).toBeGreaterThan(boxWidth(u1.body));
    });
});

describe("generated KiCad 10 sample board", () => {
    const board = checkFile(data + "sample.kicad_pcb");

    test("has every part, the back side and the DNP flag", () => {
        expect(board.footprints.length).toBe(56);
        expect(board.footprints.filter((f) => f.side === "B").length).toBe(6);
        expect(board.footprints.filter((f) => f.dnp).map((f) => f.ref)).toEqual(["R11"]);
        expect(board.outline.length).toBe(1);
        expect(board.title).toBe("human-pnp sample");
    });

    test("keeps schematic fields as props", () => {
        const u1 = board.footprints.find((f) => f.ref === "U1")!;
        expect(u1.lib).toBe("Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm");
        expect(Object.keys(u1.props)).not.toContain("Reference");
    });
});

describe("format details", () => {
    test("KiCad 8+ properties name the reference and value", () => {
        const b = parseBoard(`(kicad_pcb (version 20240108) (generator "pcbnew")
            (footprint "Device:R" (layer "F.Cu") (at 1 2 90)
                (property "Reference" "R7" (at 0 0 90) (layer "F.SilkS"))
                (property "Value" "4.7k 1%" (at 0 0 90) (layer "F.Fab"))
                (property "MPN" "RC0603FR-074K7L" (at 0 0) (layer "F.Fab"))
                (property "Datasheet" "~" (at 0 0) (layer "F.Fab"))
                (attr smd dnp)
                (pad "1" smd rect (at -1 0 90) (size 1 1) (layers "F.Cu"))
                (pad "2" smd rect (at 1 0 90) (size 1 1) (layers "F.Cu"))))`);
        const fp = b.footprints[0]!;
        expect(fp.ref).toBe("R7");
        expect(fp.value).toBe("4.7k 1%");
        expect(fp.props).toEqual({ MPN: "RC0603FR-074K7L" });
        expect(fp.dnp).toBe(true);
        expect(fp.bodyFrom).toBe("pads");
        expect(fp.pads[0]!.rot).toBe(0);
    });

    test("skips tracks and zones but keeps the outline", () => {
        const b = parseBoard(`(kicad_pcb (version 20221018)
            (segment (start 0 0) (end 1 1) (width 0.25) (layer "F.Cu") (net 1))
            (zone (net 0) (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1))))
            (gr_rect (start 0 0) (end 10 5) (layer "Edge.Cuts") (width 0.1)))`);
        expect(b.footprints.length).toBe(0);
        expect(b.outline.length).toBe(1);
        expect(b.bounds).toEqual({ x0: 0, y0: 0, x1: 10, y1: 5 });
    });

    test("rejects files that are not boards", () => {
        expect(() => parseBoard("<!DOCTYPE html><html></html>")).toThrow(BoardError);
        expect(() => parseBoard("(kicad_sch (version 20231120))")).toThrow(BoardError);
        expect(() => parseBoard("version https://git-lfs.github.com/spec/v1\noid sha256:abc")).toThrow(BoardError);
    });
});
