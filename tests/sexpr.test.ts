import { describe, expect, test } from "bun:test";
import { atom, atoms, child, children, num, parseSexpr } from "../src/sexpr";

describe("parseSexpr", () => {
    test("reads bare and quoted atoms alike", () => {
        const r = parseSexpr(`(fp_text reference R1 (at 1.5 -2) (layer "F.SilkS"))`);
        expect(r.head).toBe("fp_text");
        expect(atom(r, 0)).toBe("reference");
        expect(atom(r, 1)).toBe("R1");
        expect(num(child(r, "at"), 0)).toBe(1.5);
        expect(num(child(r, "at"), 1)).toBe(-2);
        expect(num(child(r, "at"), 2, 7)).toBe(7);
        expect(atom(child(r, "layer"), 0)).toBe("F.SilkS");
    });

    test("decodes escapes and keeps parentheses inside strings", () => {
        const r = parseSexpr(`(t "a \\"quoted\\" (word)" "line1\\nline2" "back\\\\slash" "")`);
        expect(atoms(r)).toEqual(['a "quoted" (word)', "line1\nline2", "back\\slash", ""]);
    });

    test("skips lists by head without reading them", () => {
        const r = parseSexpr(`(root (keep 1) (drop (x ")") (y)) (keep 2))`, {
            skip: (head) => head === "drop",
        });
        expect(children(r, "keep").map((k) => num(k, 0))).toEqual([1, 2]);
        expect(child(r, "drop")).toBeUndefined();
    });

    test("reports depth to the skip callback", () => {
        const seen: string[] = [];
        parseSexpr(`(a (b (c)) (d))`, {
            skip: (head, depth) => {
                seen.push(`${head}${depth}`);
                return false;
            },
        });
        expect(seen).toEqual(["a0", "b1", "c2", "d1"]);
    });

    test("hands back what it read from a truncated file", () => {
        const r = parseSexpr(`(kicad_pcb (version 4) (module X (at 1 2)`);
        expect(r.head).toBe("kicad_pcb");
        expect(num(child(r, "version"), 0)).toBe(4);
    });

    test("ignores a byte order mark and CRLF line ends", () => {
        const r = parseSexpr(String.fromCharCode(0xfeff) + "(a\r\n  (b 1)\r\n)");
        expect(num(child(r, "b"), 0)).toBe(1);
    });

    test("throws on text that is not an s-expression", () => {
        expect(() => parseSexpr("hello")).toThrow();
        expect(() => parseSexpr(")")).toThrow();
    });
});
