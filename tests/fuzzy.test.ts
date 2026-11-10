import { describe, expect, test } from "bun:test";
import { fuzzyScore, matchFields, terms, topMatches } from "../src/fuzzy";

describe("fuzzyScore", () => {
    test("needs every character in order", () => {
        expect(fuzzyScore("100n", "100nF")).toBeGreaterThan(0);
        expect(fuzzyScore("100n", "10uF 0603")).toBe(0);
        expect(fuzzyScore("ba", "ab")).toBe(0);
        expect(fuzzyScore("", "abc")).toBe(0);
    });

    test("ranks exact over prefix over scattered", () => {
        const exact = fuzzyScore("c1", "C1");
        const prefix = fuzzyScore("c1", "C10");
        const scattered = fuzzyScore("c1", "C21");
        expect(exact).toBeGreaterThan(prefix);
        expect(prefix).toBeGreaterThan(scattered);
    });

    test("prefers word starts", () => {
        expect(fuzzyScore("qfn", "QFN-56-1EP_7x7mm")).toBeGreaterThan(fuzzyScore("qfn", "aqxfxn"));
        expect(fuzzyScore("ep", "QFN-56-1EP")).toBeGreaterThan(fuzzyScore("ep", "deep"));
    });

    test("is case-insensitive", () => {
        expect(fuzzyScore("RP2040", "rp2040")).toBe(fuzzyScore("rp2040", "RP2040"));
    });
});

describe("matchFields", () => {
    const fields = [
        { text: "C9", weight: 1.2 },
        { text: "1uF 25V", weight: 1 },
        { text: "C_0603_1608Metric", weight: 0.6 },
    ];

    test("every term has to match some field", () => {
        expect(matchFields(terms("1uf 25v"), fields)).toBeGreaterThan(0);
        expect(matchFields(terms("1uf 50v"), fields)).toBe(0);
        expect(matchFields(terms("  0603  "), fields)).toBeGreaterThan(0);
    });

    test("a bonus can score a term the fields miss", () => {
        expect(matchFields(terms("0.1u"), fields)).toBe(0);
        expect(matchFields(terms("0.1u"), fields, () => 25)).toBe(25);
    });
});

describe("topMatches", () => {
    test("drops the long tail when something matches well", () => {
        const refs = ["C1", "C10", "C11", "C21", "R1"];
        const scored = refs.map((r) => [r, fuzzyScore("c1", r)] as [string, number]);
        const kept = topMatches(scored).map(([r]) => r);
        expect(kept[0]).toBe("C1");
        expect(kept).toContain("C10");
        expect(kept).not.toContain("C21");
        expect(kept).not.toContain("R1");
    });

    test("returns nothing when nothing matches", () => {
        expect(topMatches([["a", 0]])).toEqual([]);
    });
});
