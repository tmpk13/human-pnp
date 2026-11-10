import { describe, expect, test } from "bun:test";
import { normalizeText, parseValue, sameValue, valueKey } from "../src/values";

const MICRO = String.fromCharCode(0x00b5);
const OMEGA = String.fromCharCode(0x03a9);
const PLUS_MINUS = String.fromCharCode(0x00b1);

const res = (v: string) => parseValue(v, "resistor");
const cap = (v: string) => parseValue(v, "capacitor");

describe("quantities", () => {
    test("resistor notations agree", () => {
        const keys = ["4k7", "4.7k", "4K7", "4700", "4.7 kOhm", `4k7${OMEGA}`, "4.7kR", "4700R"].map((v) => res(v).base);
        expect(new Set(keys)).toEqual(new Set(["4700ohm"]));
        expect(res("2R2").num).toBeCloseTo(2.2, 12);
        expect(res("0R").num).toBe(0);
        expect(res("0").num).toBe(0);
        expect(res("R010").num).toBeCloseTo(0.01, 12);
        expect(res("1M5").num).toBe(1.5e6);
        expect(res("1Meg").num).toBe(1e6);
        expect(res("10mohm").num).toBeCloseTo(0.01, 12);
    });

    test("capacitor notations agree", () => {
        const keys = ["100nF", "100n", "0.1uF", `0.1${MICRO}F`, "100 nF", "100NF", ".1uF", "0,1uF"].map(
            (v) => cap(v).base,
        );
        expect(new Set(keys)).toEqual(new Set(["1e-7F"]));
        expect(cap("4n7").num).toBeCloseTo(4.7e-9, 20);
        expect(cap("2u2").num).toBeCloseTo(2.2e-6, 18);
    });

    test("crystals, inductors and fuses", () => {
        const xtal = (v: string) => parseValue(v, "crystal").base;
        expect(xtal("16MHz")).toBe(xtal("16M"));
        expect(xtal("16.000MHz")).toBe(xtal("16MHz"));
        expect(parseValue("32k768", "crystal").num).toBe(32768);
        expect(parseValue("32.768kHz", "crystal").num).toBe(32768);
        expect(parseValue("10uH", "inductor").base).toBe(parseValue("10u", "inductor").base);
        expect(parseValue("500mA", "fuse").num).toBe(0.5);
        expect(parseValue("600R@100MHz", "ferrite").base).toBe("600ohm");
    });

    test("part numbers stay words", () => {
        expect(parseValue("2N7002", "mosfet").base).toBe("2n7002");
        expect(parseValue("1N4148W", "diode").base).toBe("1n4148w");
        expect(cap("GRM188R71C104KA01").base).toBe("grm188r71c104ka01");
        expect(res("RC0603FR-0710KL").num).toBeUndefined();
    });
});

describe("ratings", () => {
    test("are read in any order and separator", () => {
        const a = cap("1uF 25V");
        expect(a.attrs).toEqual({ v: "25" });
        expect(valueKey(cap("1uF/25V"))).toBe(valueKey(a));
        expect(valueKey(cap("1uF_25V"))).toBe(valueKey(a));
        expect(cap("10uF 6V3").attrs.v).toBe("6.3");
        expect(cap(`100nF ${PLUS_MINUS}10% X7R 0603`).attrs).toEqual({ tol: "10%", diel: "X7R", pkg: "0603" });
        expect(cap("100pF NP0").attrs.diel).toBe(cap("100pF C0G").attrs.diel);
        expect(res("10k 1/4W").attrs.w).toBe("0.25");
        expect(res("10k +/-1%").attrs.tol).toBe("1%");
        expect(parseValue("1.5A 32V", "fuse").attrs).toEqual({ v: "32" });
    });

    test("other words must match exactly", () => {
        expect(res("10k NTC").extra).toBe("ntc");
        expect(sameValue(res("10k"), res("10k NTC"), true)).toBe(false);
    });

    test("DNP words mark the part", () => {
        expect(res("DNP").dnp).toBe(true);
        const v = res("10k DNP");
        expect(v.dnp).toBe(true);
        expect(v.base).toBe("10000ohm");
        expect(res("10k").dnp).toBe(false);
    });

    test("normalizeText spells units in ASCII", () => {
        expect(normalizeText(`  4,7 k${OMEGA} `)).toBe("4.7 kohm");
    });
});

describe("matching", () => {
    test("strict matching needs the same ratings", () => {
        expect(sameValue(cap("1uF"), cap("1uF 25V"), false)).toBe(false);
        expect(sameValue(cap("1uF 25V"), cap("1u/25V"), false)).toBe(true);
    });

    test("loose matching ignores a rating given on one side only", () => {
        expect(sameValue(cap("1uF"), cap("1uF 25V"), true)).toBe(true);
        expect(sameValue(cap("1uF 25V"), cap("1uF"), true)).toBe(true);
        expect(sameValue(cap("1uF 25V"), cap("1uF 50V"), true)).toBe(false);
        expect(sameValue(cap("1uF 25V X5R"), cap("1uF X7R"), true)).toBe(false);
        expect(sameValue(cap("1uF"), cap("10uF"), true)).toBe(false);
    });
});
