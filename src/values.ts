// Reading part values such as "4k7", "100nF 25V X7R" or "1uF/50V 0603" so
// that values written differently but meaning the same part match.
//
// A value splits into a base (a number with a unit, or the first word of a
// part number), recognized ratings (voltage, tolerance, power, current,
// dielectric, package) and any other words. Two values name the same part
// when base, ratings and other words are equal. In "loose" matching a
// rating that only one side gives is not held against the match, so "1uF"
// matches "1uF 25V" (but "1uF 25V" still differs from "1uF 50V").

import type { Kind } from "./classify";

const MICRO = String.fromCharCode(0x00b5);
const MU = String.fromCharCode(0x03bc);
const OMEGA = String.fromCharCode(0x03a9);
const OHM_SIGN = String.fromCharCode(0x2126);
const PLUS_MINUS = String.fromCharCode(0x00b1);

export interface ParsedValue {
    // Base: a number in base units with its unit ("1e-7F"), or a lowercased
    // word when the value is not a quantity.
    base: string;
    // The base quantity, when there is one (for sorting).
    num?: number;
    unit?: string;
    // Recognized ratings, canonical: v (volts), tol (percent), w (watts),
    // a (amps), diel (dielectric), pkg (imperial size code).
    attrs: Record<string, string>;
    // Other words in order, lowercased.
    extra: string;
    // The value says the part is not fitted (DNP, DNF, ...).
    dnp: boolean;
}

// The unit a bare number means for each kind of part. Only these kinds get
// their value read as a quantity; part numbers such as 2N7002 stay words.
const DEFAULT_UNIT: Partial<Record<Kind, string>> = {
    resistor: "ohm",
    resistor_array: "ohm",
    potentiometer: "ohm",
    thermistor: "ohm",
    capacitor: "F",
    capacitor_polarized: "F",
    inductor: "H",
    ferrite: "ohm",
    crystal: "Hz",
    fuse: "A",
};

const MULTIPLIER: Record<string, number> = {
    p: 1e-12,
    P: 1e-12,
    n: 1e-9,
    N: 1e-9,
    u: 1e-6,
    U: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    g: 1e9,
    R: 1,
    r: 1,
};

const UNITS: [RegExp, string][] = [
    [/^ohms?/i, "ohm"],
    [/^hz/i, "Hz"],
    [/^[r]/i, "ohm"],
    [/^f/i, "F"],
    [/^h/i, "H"],
    [/^v/i, "V"],
    [/^a/i, "A"],
    [/^w/i, "W"],
];

// Characters that may follow a value's base.
const BOUNDARY = /^($|[\s/_,;@()\-])/;

// Round to 6 significant digits so 4k7 and 4.7k give the same number.
export function canon(n: number): string {
    return String(Number(n.toPrecision(6)));
}

// ASCII spellings, no plus-minus sign, decimal commas as points.
export function normalizeText(raw: string): string {
    let s = raw;
    s = s.split(MICRO).join("u").split(MU).join("u");
    s = s.split(OMEGA).join("ohm").split(OHM_SIGN).join("ohm");
    s = s.split(PLUS_MINUS).join("").replace(/\+\/-|\+-/g, "");
    s = s.replace(/(\d),(\d)/g, "$1.$2");
    // Fractional watts: 1/4W -> 0.25W, before "/" is read as a separator.
    s = s.replace(/(\d+)\/(\d+)\s*(w)\b/gi, (_m, a: string, b: string, w: string) =>
        `${canon(Number(a) / Number(b))}${w}`,
    );
    return s.trim().replace(/\s+/g, " ");
}

interface Quantity {
    num: number;
    unit: string;
    rest: string;
}

// A quantity at the start of `s`: "4k7", "100 nF", "2R2", "16MHz", "0.1uF".
export function parseQuantity(s: string, defaultUnit: string): Quantity | null {
    // Leading-R form for small resistances: R010 is 0.010 ohm.
    const lead = /^[Rr](\d+)(?=$|[\s/_,;@()-])/.exec(s);
    if (lead && defaultUnit === "ohm") {
        return { num: Number(`0.${lead[1]}`), unit: "ohm", rest: s.slice(lead[0].length) };
    }
    const m = /^(\d+(?:\.\d+)?|\.\d+)/.exec(s);
    if (!m) return null;
    const mantissa = m[1]!;
    let i = m[0].length;
    while (s[i] === " ") i++;
    let mult = 1;
    let rkm = "";
    let unitFromMultiplier = "";
    const megs = /^meg/i.exec(s.slice(i));
    if (megs) {
        mult = 1e6;
        i += 3;
    } else {
        const c = s[i];
        // An F or H right after the number is a unit, not a multiplier.
        if (c !== undefined && c in MULTIPLIER && !/^[a-zA-Z]{3}/.test(s.slice(i, i + 3) + "  ")) {
            mult = MULTIPLIER[c]!;
            if (c === "R" || c === "r") unitFromMultiplier = "ohm";
            i++;
        } else if (c !== undefined && c in MULTIPLIER) {
            // Words such as "mohm", "kohm", "MHz": a multiplier then a unit.
            const word = s.slice(i + 1).toLowerCase();
            if (/^(ohm|hz)/.test(word)) {
                mult = MULTIPLIER[c]!;
                i++;
            }
        }
        // RKM code: digits after the multiplier letter stand after a point.
        if (mult !== 1 || unitFromMultiplier) {
            const d = /^\d+/.exec(s.slice(i));
            if (d && !mantissa.includes(".")) {
                rkm = d[0];
                i += d[0].length;
            }
        }
    }
    let unit = unitFromMultiplier;
    if (!unit) {
        const tail = s.slice(i);
        for (const [re, u] of UNITS) {
            const um = re.exec(tail);
            if (um) {
                unit = u;
                i += um[0].length;
                break;
            }
        }
        // "s" of a plural unit such as "ohms" was taken by the regex.
    }
    if (!BOUNDARY.test(s.slice(i))) return null;
    const value = Number(rkm ? `${mantissa}.${rkm}` : mantissa) * mult;
    if (!Number.isFinite(value)) return null;
    return { num: value, unit: unit || defaultUnit, rest: s.slice(i) };
}

const DNP_WORDS = new Set(["dnp", "dnf", "dni", "nopop", "no-pop", "nofit", "nf"]);
const PACKAGES = new Set(["01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2220", "2512"]);

// Recognize one word after the base; returns [key, canonical value] or null.
export function ratingOf(word: string): [string, string] | null {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+(?:\.\d+)?)(k)?v(?:dc|ac)?$/.exec(word))) return ["v", canon(Number(m[1]) * (m[2] ? 1e3 : 1))];
    if ((m = /^(\d+)v(\d+)$/.exec(word))) return ["v", canon(Number(`${m[1]}.${m[2]}`))];
    if ((m = /^[+-]?(\d+(?:\.\d+)?)%$/.exec(word))) return ["tol", `${canon(Number(m[1]))}%`];
    if ((m = /^(\d+(?:\.\d+)?)(m)?w$/.exec(word))) return ["w", canon(Number(m[1]) * (m[2] ? 1e-3 : 1))];
    if ((m = /^(\d+(?:\.\d+)?)(m|u)?a$/.exec(word))) {
        return ["a", canon(Number(m[1]) * (m[2] === "m" ? 1e-3 : m[2] === "u" ? 1e-6 : 1))];
    }
    if (/^(c0g|cog|np0|npo)$/.test(word)) return ["diel", "C0G"];
    if (/^(x[5-8][rstpuv]|y5v|z5u)$/.test(word)) return ["diel", word.toUpperCase()];
    if (PACKAGES.has(word)) return ["pkg", word];
    return null;
}

export function parseValue(raw: string, kind: Kind): ParsedValue {
    const text = normalizeText(raw);
    const out: ParsedValue = { base: "", attrs: {}, extra: "", dnp: false };
    let rest = text;
    const unit = DEFAULT_UNIT[kind];
    const q = unit ? parseQuantity(text, unit) : null;
    if (q) {
        out.num = q.num;
        out.unit = q.unit;
        out.base = `${canon(q.num)}${q.unit}`;
        rest = q.rest;
    }
    const words = rest
        .toLowerCase()
        .split(/[\s/_,;]+/)
        .map((w) => w.replace(/^-+/, ""))
        .filter((w) => w.length > 0);
    const extra: string[] = [];
    for (const w of words) {
        if (DNP_WORDS.has(w)) {
            out.dnp = true;
            continue;
        }
        if (!out.base) {
            out.base = w;
            continue;
        }
        const r = ratingOf(w);
        if (r && !(r[0] in out.attrs)) out.attrs[r[0]] = r[1];
        else extra.push(w);
    }
    out.extra = extra.join(" ");
    return out;
}

// Canonical text for a value; equal keys mean the same part in strict
// matching.
export function valueKey(v: ParsedValue): string {
    const attrs = Object.keys(v.attrs)
        .sort()
        .map((k) => `${k}=${v.attrs[k]}`)
        .join(",");
    return `${v.base}|${attrs}|${v.extra}`;
}

// Same part? In loose matching a rating given on only one side is ignored.
export function sameValue(a: ParsedValue, b: ParsedValue, loose: boolean): boolean {
    if (a.base !== b.base || a.extra !== b.extra) return false;
    if (!loose) return valueKey(a) === valueKey(b);
    for (const k of Object.keys(a.attrs)) {
        if (k in b.attrs && b.attrs[k] !== a.attrs[k]) return false;
    }
    return true;
}
