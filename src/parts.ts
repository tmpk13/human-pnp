// Parts and value groups: which footprints get placed by hand, and which
// of them share a value (one reel, one bag) and so belong together.

import { classify, KIND_INFO, NOT_PLACED, type Kind } from "./classify";
import type { Board, Footprint } from "./kicad";
import { parseValue, sameValue, valueKey, type ParsedValue } from "./values";

export interface Part {
    fp: Footprint;
    kind: Kind;
    value: ParsedValue;
    // Listed for placing. Holes, fiducials, graphics, footprints without
    // pads and parts left out of the BOM are drawn but not listed.
    placeable: boolean;
    // Do not populate: flagged in the board file or written in the value.
    dnp: boolean;
    // Footprint name without its library, e.g. "R_0402_1005Metric".
    pkg: string;
}

export interface Group {
    key: string;
    kind: Kind;
    // The value as most of the group's parts write it.
    label: string;
    value: ParsedValue;
    // The most common footprint name in the group.
    pkg: string;
    parts: Part[];
    dnp: boolean;
}

export function footprintName(lib: string): string {
    return lib.slice(lib.indexOf(":") + 1);
}

export function makeParts(board: Board): Part[] {
    return board.footprints.map((fp) => {
        const kind = classify(fp);
        const value = parseValue(fp.value, kind);
        const placeable = !NOT_PLACED.has(kind) && !fp.noBom && !fp.boardOnly && fp.pads.length > 0;
        return { fp, kind, value, placeable, dnp: fp.dnp || value.dnp, pkg: footprintName(fp.lib) };
    });
}

export function compareRefs(a: string, b: string): number {
    return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

function mostCommon(values: string[]): string {
    const counts = new Map<string, number>();
    let best = values[0] ?? "";
    let bestN = 0;
    for (const v of values) {
        const n = (counts.get(v) ?? 0) + 1;
        counts.set(v, n);
        if (n > bestN) {
            best = v;
            bestN = n;
        }
    }
    return best;
}

function groupOrder(a: Group, b: Group): number {
    if (a.dnp !== b.dnp) return a.dnp ? 1 : -1;
    const k = KIND_INFO[a.kind].order - KIND_INFO[b.kind].order;
    if (k) return k;
    const an = a.value.num;
    const bn = b.value.num;
    if (an !== undefined && bn !== undefined && an !== bn) return an - bn;
    if ((an === undefined) !== (bn === undefined)) return an === undefined ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// Group placeable parts by kind and value (and footprint when asked).
export function buildGroups(parts: Part[], byFootprint: boolean): Group[] {
    const map = new Map<string, Part[]>();
    for (const p of parts) {
        if (!p.placeable) continue;
        const key = `${p.dnp ? "dnp|" : ""}${p.kind}|${valueKey(p.value)}|${byFootprint ? p.pkg : ""}`;
        const list = map.get(key);
        if (list) list.push(p);
        else map.set(key, [p]);
    }
    const groups: Group[] = [];
    for (const [key, list] of map) {
        list.sort((a, b) => compareRefs(a.fp.ref, b.fp.ref));
        const first = list[0]!;
        groups.push({
            key,
            kind: first.kind,
            label: mostCommon(list.map((p) => p.fp.value)),
            value: first.value,
            pkg: mostCommon(list.map((p) => p.pkg)),
            parts: list,
            dnp: first.dnp,
        });
    }
    return groups.sort(groupOrder);
}

export interface KindProgress {
    kind: Kind;
    // Parts of this kind to place, and how many of them are marked placed.
    total: number;
    done: number;
}

// Placing progress per kind over the parts to place (listed, not DNP), in
// list order. Kinds with nothing to place are left out.
export function progressByKind(parts: Part[], placed: ReadonlySet<string>): KindProgress[] {
    const byKind = new Map<Kind, KindProgress>();
    for (const p of parts) {
        if (!p.placeable || p.dnp) continue;
        let k = byKind.get(p.kind);
        if (!k) {
            k = { kind: p.kind, total: 0, done: 0 };
            byKind.set(p.kind, k);
        }
        k.total++;
        if (placed.has(p.fp.ref)) k.done++;
    }
    return [...byKind.values()].sort((a, b) => KIND_INFO[a.kind].order - KIND_INFO[b.kind].order);
}

// Groups holding the same part as `g`: only `g` itself in strict matching;
// in loose matching also groups that leave out a rating `g` gives or give
// one `g` leaves out.
export function relatedGroups(groups: Group[], g: Group, loose: boolean, byFootprint: boolean): Group[] {
    return groups.filter(
        (h) =>
            h === g ||
            (h.kind === g.kind &&
                h.dnp === g.dnp &&
                (!byFootprint || h.pkg === g.pkg) &&
                sameValue(g.value, h.value, loose)),
    );
}
