// Fuzzy matching for the parts search: the query's characters must appear
// in order in the text, not necessarily next to each other. Runs of
// adjacent characters, matches at word starts and whole or leading matches
// score higher, gaps score lower.

const CONSECUTIVE = 2;
const WORD_START = 2;
const GAP = 0.2;
const EXACT = 5;
const PREFIX = 3;

function isSeparator(c: string): boolean {
    return " _-:./,()@+#".includes(c);
}

function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
}

// Does position j of `text` start a word: after a separator, at a change
// between letters and digits, or at a lower-to-upper case change?
function wordStart(text: string, j: number): boolean {
    if (j === 0) return true;
    const prev = text[j - 1]!;
    const cur = text[j]!;
    if (isSeparator(prev)) return true;
    if (isDigit(prev) !== isDigit(cur)) return true;
    return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

// Score of the best in-order match of `query` in `text`; 0 when there is
// no match. Case-insensitive.
export function fuzzyScore(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    const n = q.length;
    const m = t.length;
    if (n === 0) return 0;
    if (n > m) return 0;
    // Quick reject: not a subsequence.
    let k = 0;
    for (let j = 0; j < m && k < n; j++) if (t[j] === q[k]) k++;
    if (k < n) return 0;

    // best[j]: best score with the current query character at text j.
    let prev = new Array<number>(m).fill(-Infinity);
    let cur = new Array<number>(m).fill(-Infinity);
    for (let i = 0; i < n; i++) {
        cur.fill(-Infinity);
        // run: best score of the previous character at some k < j, less
        // the gap penalty for the characters between.
        let run = -Infinity;
        for (let j = i; j < m; j++) {
            if (i > 0 && j > 0) run = Math.max(run - GAP, prev[j - 1]!);
            if (t[j] !== q[i]) continue;
            const bonus = 1 + (wordStart(text, j) ? WORD_START : 0);
            if (i === 0) {
                cur[j] = bonus - GAP * 0.25 * j;
            } else {
                const chained = j > 0 ? prev[j - 1]! + CONSECUTIVE : -Infinity;
                const best = Math.max(chained, run);
                if (best > -Infinity) cur[j] = bonus + best;
            }
        }
        [prev, cur] = [cur, prev];
    }
    let score = Math.max(...prev);
    if (score === -Infinity) return 0;
    if (t === q) score += EXACT;
    else if (t.startsWith(q)) score += PREFIX;
    return Math.max(score, 0.01);
}

export interface Field {
    text: string;
    weight: number;
}

// Split a query into terms; every term has to match some field.
export function terms(query: string): string[] {
    return query
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0);
}

// Sum over the query terms of each term's best weighted field score; 0
// when some term matches no field. `bonus` can score a term by other means
// (such as reading it as a part value); the higher score counts.
export function matchFields(queryTerms: string[], fields: Field[], bonus?: (term: string) => number): number {
    let total = 0;
    for (const term of queryTerms) {
        let best = bonus ? bonus(term) : 0;
        for (const f of fields) {
            if (!f.text) continue;
            const s = fuzzyScore(term, f.text) * f.weight;
            if (s > best) best = s;
        }
        if (best === 0) return 0;
        total += best;
    }
    return total;
}

// Keep the results scoring at least `ratio` of the best one: a query that
// matches something well drops the long tail of scattered matches.
export function topMatches<T>(scored: [T, number][], ratio = 0.6): [T, number][] {
    const hits = scored.filter(([, s]) => s > 0);
    if (!hits.length) return [];
    const best = Math.max(...hits.map(([, s]) => s));
    return hits.filter(([, s]) => s >= best * ratio).sort((a, b) => b[1] - a[1]);
}
