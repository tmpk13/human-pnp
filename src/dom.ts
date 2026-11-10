// Small DOM helpers and the interface icons (inline SVG, so the UI needs no
// icon font or glyphs).

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

// Create an element. Props: "class", "html" (trusted markup only), "on*"
// event handlers, booleans as present/absent attributes, everything else
// as attributes.
export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Props = {},
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") el.className = String(v);
        else if (k === "html") el.innerHTML = String(v);
        else if (k.startsWith("on") && typeof v === "function") {
            el.addEventListener(k.slice(2), v as EventListener);
        } else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
    }
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        el.append(typeof c === "number" ? String(c) : c);
    }
    return el;
}

const svg = (body: string, extra = "") =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    gear: svg(
        '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    ),
    search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    fit: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    flip: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
    chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
    chevronUp: svg('<path d="M6 15l6-6 6 6"/>'),
    file: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
    board: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><rect x="7" y="9" width="4" height="6"/><path d="M14 10h3M14 14h3"/>'),
    upload: svg('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'),
};

export function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// File name without folders or the .kicad_pcb extension.
export function boardName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1).replace(/\.kicad_pcb$/i, "");
}

// Let the browser paint (a status message) before a long synchronous step.
export function nextPaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
