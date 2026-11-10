// S-expression reader for KiCad files.
//
// A list such as (layer "F.Cu") becomes { head: "layer", items: ["F.Cu"] }.
// Quoted and bare atoms both become plain strings: KiCad 5 writes
// (fp_text reference R1) where KiCad 6+ writes (fp_text reference "R1"),
// and the two mean the same thing.
//
// Large boards are mostly tracks, vias and zone fills. The `skip` option
// drops whole subtrees by their head word without building nodes for them,
// which keeps memory and time low on 50+ MB files.

export interface SList {
    head: string;
    items: SNode[];
}

export type SNode = SList | string;

export interface ParseOptions {
    // Return true to drop the list with this head at this depth (the root
    // list is depth 0, its children depth 1, and so on).
    skip?: (head: string, depth: number) => boolean;
}

const OPEN = 40; // (
const CLOSE = 41; // )
const QUOTE = 34; // "
const BACKSLASH = 92;

function isSpace(c: number): boolean {
    return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 0xfeff;
}

// Index just past the bare atom starting at i.
function atomEnd(text: string, i: number): number {
    const n = text.length;
    while (i < n) {
        const c = text.charCodeAt(i);
        if (c === OPEN || c === CLOSE || isSpace(c)) break;
        i++;
    }
    return i;
}

// Index just past the closing quote of the string whose opening quote is at i.
function stringEnd(text: string, i: number): number {
    const n = text.length;
    i++;
    while (i < n) {
        const c = text.charCodeAt(i);
        if (c === BACKSLASH) i += 2;
        else if (c === QUOTE) return i + 1;
        else i++;
    }
    return n;
}

function unescape(body: string): string {
    if (body.indexOf("\\") < 0) return body;
    let out = "";
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch !== "\\" || i + 1 >= body.length) {
            out += ch;
            continue;
        }
        const next = body[++i];
        out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
    }
    return out;
}

// Index just past the ")" that closes a list whose "(" and head were
// already consumed; `i` points somewhere inside that list.
function skipList(text: string, i: number): number {
    const n = text.length;
    let depth = 1;
    while (i < n) {
        const c = text.charCodeAt(i);
        if (c === QUOTE) {
            i = stringEnd(text, i);
            continue;
        }
        if (c === OPEN) depth++;
        else if (c === CLOSE && --depth === 0) return i + 1;
        i++;
    }
    return n;
}

export class ParseError extends Error {}

// Parse the first top-level list in `text`.
export function parseSexpr(text: string, opts: ParseOptions = {}): SList {
    const skip = opts.skip;
    const n = text.length;
    const stack: SList[] = [];
    let cur: SList | null = null;
    let i = 0;
    while (i < n) {
        const c = text.charCodeAt(i);
        if (isSpace(c)) {
            i++;
        } else if (c === OPEN) {
            i++;
            while (i < n && isSpace(text.charCodeAt(i))) i++;
            let head = "";
            if (i < n && text.charCodeAt(i) === QUOTE) {
                const end = stringEnd(text, i);
                head = unescape(text.slice(i + 1, end - 1));
                i = end;
            } else {
                const end = atomEnd(text, i);
                head = text.slice(i, end);
                i = end;
            }
            if (skip && skip(head, stack.length + (cur ? 1 : 0))) {
                i = skipList(text, i);
                continue;
            }
            const node: SList = { head, items: [] };
            if (cur) {
                cur.items.push(node);
                stack.push(cur);
            }
            cur = node;
        } else if (c === CLOSE) {
            i++;
            if (!cur) throw new ParseError(`unbalanced ")" at offset ${i - 1}`);
            const parent = stack.pop();
            if (!parent) return cur;
            cur = parent;
        } else if (c === QUOTE) {
            const end = stringEnd(text, i);
            if (!cur) throw new ParseError(`text outside a list at offset ${i}`);
            cur.items.push(unescape(text.slice(i + 1, end - 1)));
            i = end;
        } else {
            const end = atomEnd(text, i);
            if (!cur) throw new ParseError(`text outside a list at offset ${i}`);
            cur.items.push(text.slice(i, end));
            i = end;
        }
    }
    if (cur) {
        // A truncated file: hand back what was read so far.
        return stack[0] ?? cur;
    }
    throw new ParseError("no list found");
}

// --- Accessors -----------------------------------------------------------

export function isList(n: SNode | undefined): n is SList {
    return typeof n === "object" && n !== null;
}

// First child list with this head.
export function child(list: SList | undefined, head: string): SList | undefined {
    if (!list) return undefined;
    for (const it of list.items) if (typeof it !== "string" && it.head === head) return it;
    return undefined;
}

// Every child list with this head.
export function children(list: SList, head: string): SList[] {
    const out: SList[] = [];
    for (const it of list.items) if (typeof it !== "string" && it.head === head) out.push(it);
    return out;
}

// The atom at position `idx` (0 is the first item after the head).
export function atom(list: SList | undefined, idx: number): string | undefined {
    const it = list?.items[idx];
    return typeof it === "string" ? it : undefined;
}

// The atom at `idx` as a number, or `dflt` when missing or not numeric.
export function num(list: SList | undefined, idx: number, dflt = 0): number {
    const a = atom(list, idx);
    if (a === undefined) return dflt;
    const v = Number(a);
    return Number.isFinite(v) ? v : dflt;
}

// All bare atoms of a list, e.g. the flags in (attr smd exclude_from_bom).
export function atoms(list: SList | undefined): string[] {
    if (!list) return [];
    const out: string[] = [];
    for (const it of list.items) if (typeof it === "string") out.push(it);
    return out;
}
