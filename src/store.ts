// Settings, recent boards, placed marks and the list height, kept in
// localStorage. Every GitHub Pages project site of an account shares one
// origin (<user>.github.io), so keys carry a prefix. Storage can be missing
// or full (private windows, blocked site data); then nothing persists and
// the app still works.

const PREFIX = "human-pnp:";

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        // Storage unavailable: keep working without it.
    }
}

export type Theme = "auto" | "light" | "dark";

export interface Settings {
    // A rating given on only one side does not stop a match
    // (1uF matches 1uF 25V).
    looseRatings: boolean;
    // Parts in different footprints are different parts.
    matchFootprint: boolean;
    showPads: boolean;
    showLabels: boolean;
    theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
    looseRatings: true,
    matchFootprint: false,
    showPads: true,
    showLabels: true,
    theme: "auto",
};

export function loadSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}) };
}

export function saveSettings(s: Settings): void {
    write("settings", s);
}

export interface Recent {
    owner: string;
    repo: string;
    ref: string;
    path: string;
}

export function loadRecents(): Recent[] {
    const list = read<Recent[]>("recents", []);
    return Array.isArray(list) ? list.filter((r) => r && r.owner && r.repo && r.path) : [];
}

export function addRecent(r: Recent): void {
    const same = (a: Recent) => a.owner === r.owner && a.repo === r.repo && a.path === r.path;
    write("recents", [r, ...loadRecents().filter((a) => !same(a))].slice(0, 8));
}

// Placed marks per board, keyed by "<owner>/<repo>/<path>" or a local
// file's name.
export function loadPlaced(board: string): Set<string> {
    const refs = read<string[]>(`placed:${board}`, []);
    return new Set(Array.isArray(refs) ? refs : []);
}

export function savePlaced(board: string, refs: Set<string>): void {
    write(`placed:${board}`, [...refs]);
}

// Height of the parts list as a fraction of the board area.
export function loadSheetFraction(): number {
    const f = read<number>("sheet", 0.38);
    return typeof f === "number" && f > 0.05 && f < 0.95 ? f : 0.38;
}

export function saveSheetFraction(f: number): void {
    write("sheet", f);
}
