import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { classify, refPrefix, type PartText } from "../src/classify";
import { parseBoard } from "../src/kicad";
import { buildGroups, compareRefs, makeParts, relatedGroups, type Group } from "../src/parts";

const part = (ref: string, lib: string, value = "", descr = "", props: Record<string, string> = {}): PartText => ({
    ref,
    lib,
    value,
    descr,
    props,
});

describe("classify", () => {
    test("by reference prefix and footprint", () => {
        expect(classify(part("R1", "Resistor_SMD:R_0603_1608Metric", "10k"))).toBe("resistor");
        expect(classify(part("C1", "Capacitor_SMD:C_0402_1005Metric"))).toBe("capacitor");
        expect(classify(part("C2", "Capacitor_SMD:CP_Elec_5x5.4"))).toBe("capacitor_polarized");
        expect(classify(part("C3", "Capacitor_Tantalum_SMD:CP_EIA-3216-18_Kemet-A"))).toBe("capacitor_polarized");
        expect(classify(part("D1", "LED_SMD:LED_0603_1608Metric", "Green"))).toBe("led");
        expect(classify(part("D2", "Diode_SMD:D_SOD-123", "1N4148W"))).toBe("diode");
        expect(classify(part("D3", "Diode_SMD:D_0603", "", "", { Description: "Light emitting diode" }))).toBe("led");
        expect(classify(part("Q1", "Package_TO_SOT_SMD:SOT-23", "2N7002"))).toBe("mosfet");
        expect(classify(part("Q2", "Package_TO_SOT_SMD:SOT-23", "MMBT3904"))).toBe("bjt");
        expect(classify(part("U1", "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"))).toBe("ic");
        expect(classify(part("J1", "Connector_USB:USB_C_Receptacle"))).toBe("connector");
        expect(classify(part("Y1", "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm", "12MHz"))).toBe("crystal");
        expect(classify(part("X1", "Oscillator:Oscillator_SMD_EuroQuartz_XO32", "16MHz"))).toBe("crystal");
        expect(classify(part("X2", "Connector_PinHeader_2.54mm:PinHeader_1x02"))).toBe("connector");
        expect(classify(part("SW1", "Button_Switch_SMD:SW_Push_1P1T_NO_CK_KMR2"))).toBe("switch");
        expect(classify(part("FB1", "Inductor_SMD:L_0603_1608Metric"))).toBe("ferrite");
        expect(classify(part("L2", "Inductor_SMD:L_0603_1608Metric", "BLM18", "Ferrite bead"))).toBe("ferrite");
        expect(classify(part("RV1", "Potentiometer_THT:Potentiometer_Bourns_3296W"))).toBe("potentiometer");
        expect(classify(part("TH1", "Resistor_SMD:R_0603_1608Metric", "10k"))).toBe("thermistor");
        expect(classify(part("T1", "Package_TO_SOT_SMD:SOT-23", "BC847"))).toBe("bjt");
        expect(classify(part("T2", "Transformer_SMD:Pulse_PA2001NL"))).toBe("transformer");
    });

    test("footprints that say what they are win over the prefix", () => {
        expect(classify(part("H1", "MountingHole:MountingHole_3.2mm_M3"))).toBe("mounting_hole");
        expect(classify(part("FID1", "Fiducial:Fiducial_1mm_Mask2mm"))).toBe("fiducial");
        expect(classify(part("TP1", "TestPoint:TestPoint_Pad_D1.0mm"))).toBe("testpoint");
        expect(classify(part("G1", "Symbol:KiCad-Logo_5mm_SilkScreen"))).toBe("logo");
    });

    test("an unknown prefix falls back to the footprint", () => {
        expect(classify(part("ZZ1", "Resistor_SMD:R_0603_1608Metric"))).toBe("resistor");
        expect(classify(part("ZZ2", "Package_DFN_QFN:QFN-32-1EP_5x5mm"))).toBe("ic");
        expect(classify(part("REF**", "Something:Else"))).toBe("other");
        expect(classify(part("PWR_SW1", "easyeda2kicad:SW-TH_TK-6580A8-1"))).toBe("switch");
        expect(classify(part("I2C2", "easyeda2kicad:HDR-TH_4P-P2.54-V-F"))).toBe("connector");
        expect(classify(part("JFP1", "wren:HARWIN_M22-6541042R"))).toBe("connector");
        expect(classify(part("CV1", "footprints:CV3-30PF", "5/30pF"))).toBe("capacitor");
    });

    test("refPrefix and natural ref order", () => {
        expect(refPrefix("LED12")).toBe("LED");
        expect(refPrefix("r5")).toBe("R");
        expect(["R10", "R2", "R1", "C3"].sort(compareRefs)).toEqual(["C3", "R1", "R2", "R10"]);
    });
});

describe("groups on the sample board", () => {
    const board = parseBoard(readFileSync(new URL("./data/sample.kicad_pcb", import.meta.url), "utf8"));
    const parts = makeParts(board);
    const groups = buildGroups(parts, false);
    const refs = (g: Group | undefined) => g?.parts.map((p) => p.fp.ref);
    const find = (gs: Group[], ref: string) => gs.find((g) => g.parts.some((p) => p.fp.ref === ref));

    test("values written differently share a group", () => {
        expect(refs(find(groups, "C1"))).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C20", "C21"]);
        expect(find(groups, "C1")!.label).toBe("100nF");
        expect(refs(find(groups, "R9"))).toEqual(["R9", "R10"]);
        expect(refs(find(groups, "R6"))).toEqual(["R6", "R7"]);
        expect(refs(find(groups, "R1"))).toEqual(["R1", "R2", "R3", "R20", "R21"]);
    });

    test("holes and fiducials are not listed; DNP parts are listed last", () => {
        const listed = new Set(groups.flatMap((g) => g.parts.map((p) => p.fp.ref)));
        for (const r of ["H1", "H2", "FID1", "FID2"]) expect(listed.has(r)).toBe(false);
        const last = groups[groups.length - 1]!;
        expect(last.dnp).toBe(true);
        expect(refs(last)).toEqual(["R11"]);
    });

    test("loose matching joins 1uF with 1uF 25V and 1uF 50V, but not 25V with 50V", () => {
        const g1 = find(groups, "C7")!;
        const g25 = find(groups, "C9")!;
        const related = (g: Group, loose: boolean) =>
            relatedGroups(groups, g, loose, false)
                .flatMap((h) => refs(h)!)
                .sort(compareRefs);
        expect(related(g1, false)).toEqual(["C7", "C8", "C22"]);
        expect(related(g1, true)).toEqual(["C7", "C8", "C9", "C10", "C11", "C22"]);
        expect(related(g25, true)).toEqual(["C7", "C8", "C9", "C10", "C22"]);
    });

    test("grouping by footprint splits sizes", () => {
        const byFp = buildGroups(parts, true);
        expect(refs(find(byFp, "C7"))).toEqual(["C7", "C8"]);
        expect(refs(find(byFp, "C22"))).toEqual(["C22"]);
        const g25 = find(byFp, "C9")!;
        const related = relatedGroups(byFp, g25, true, true).flatMap((h) => refs(h)!);
        expect(related.sort(compareRefs)).toEqual(["C9", "C10", "C22"]);
    });

    test("groups are ordered by kind, then value", () => {
        const kinds = groups.filter((g) => !g.dnp).map((g) => g.kind);
        expect(kinds.indexOf("resistor")).toBeLessThan(kinds.indexOf("capacitor"));
        const caps = groups.filter((g) => g.kind === "capacitor").map((g) => g.label);
        expect(caps.indexOf("12pF")).toBeLessThan(caps.indexOf("100nF"));
        expect(caps.indexOf("100nF")).toBeLessThan(caps.indexOf("1uF"));
    });
});
