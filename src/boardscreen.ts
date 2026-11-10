// The board screen: the board drawing, a search box, the side switch,
// settings, and the parts list as a bottom sheet. Tapping a part (on the
// board or in the list) selects its value and lights up every part with
// the same value; the list can mark parts as placed.

import { KIND_INFO } from "./classify";
import { h, ICONS } from "./dom";
import { matchFields, terms, topMatches, type Field } from "./fuzzy";
import type { Board, Side } from "./kicad";
import { buildGroups, makeParts, relatedGroups, type Group, type Part } from "./parts";
import { Sheet } from "./sheet";
import { loadPlaced, savePlaced, saveSettings, type Settings, type Theme } from "./store";
import { symbolSvg } from "./symbols";
import { parseValue } from "./values";
import { BoardView, type Palette, type ViewState } from "./view";

export interface BoardSource {
    // Board file name without the extension.
    name: string;
    // "owner/repo", or "Local file".
    where: string;
    // Key the placed marks are stored under.
    key: string;
    // The file on GitHub.
    link?: string;
}

const SIDE_NAME: Record<Side, string> = { F: "top", B: "bottom" };

export function readPalette(): Palette {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim() || "#808080";
    return {
        bg: v("--c-bg"),
        board: v("--c-board"),
        edge: v("--c-edge"),
        part: v("--c-part"),
        partEdge: v("--c-part-edge"),
        pad: v("--c-pad"),
        pad1: v("--c-pad1"),
        symbol: v("--c-symbol"),
        ref: v("--c-ref"),
        value: v("--c-value"),
        hl: v("--c-hl"),
        focus: v("--c-focus"),
        search: v("--c-search"),
        placed: v("--c-placed"),
        dnp: v("--c-dnp"),
        labelBg: v("--c-label-bg"),
    };
}

export function applyTheme(t: Theme): void {
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function showBoard(
    root: HTMLElement,
    board: Board,
    source: BoardSource,
    settings: Settings,
    onBack: () => void,
): () => void {
    const parts = makeParts(board);
    const placeable = parts.filter((p) => p.placeable);
    let groups = buildGroups(parts, settings.matchFootprint);
    let groupOf = new Map<Part, Group>();
    let groupByKey = new Map<string, Group>();
    const indexGroups = () => {
        groupOf = new Map(groups.flatMap((g) => g.parts.map((p) => [p, g] as [Part, Group])));
        groupByKey = new Map(groups.map((g) => [g.key, g]));
    };
    indexGroups();
    const fields = new Map<Part, Field[]>(
        placeable.map((p) => [
            p,
            [
                { text: p.fp.ref, weight: 1.2 },
                { text: p.fp.value, weight: 1 },
                { text: p.pkg, weight: 0.6 },
                { text: KIND_INFO[p.kind].label, weight: 0.5 },
                ...Object.values(p.fp.props).map((text) => ({ text, weight: 0.4 })),
            ],
        ]),
    );
    const placed = loadPlaced(source.key);
    const state: ViewState = {
        highlight: new Set(),
        focus: null,
        search: null,
        placed,
        showPads: settings.showPads,
        showLabels: settings.showLabels,
    };
    let selected: Group | null = null;
    let related: Group[] = [];
    let hits: Map<Part, number> | null = null;

    // --- Elements -------------------------------------------------------------

    const search = h("input", {
        type: "search",
        class: "search-input",
        placeholder: "Search parts",
        "aria-label": "Search parts by reference, value or footprint",
        enterkeyhint: "search",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
    });
    const clearSearch = h("button", { class: "icon-btn clear-search", "aria-label": "Clear search", html: ICONS.close });
    clearSearch.hidden = true;
    const sideBtn = h("button", { class: "side-btn", title: "Turn the board over" });
    const gearBtn = h("button", { class: "icon-btn", "aria-label": "Settings", html: ICONS.gear });
    const backBtn = h("button", { class: "icon-btn", "aria-label": "Back", html: ICONS.back, onclick: onBack });
    const topbar = h(
        "header",
        { class: "topbar" },
        backBtn,
        h("div", { class: "search" }, h("span", { class: "search-icon", html: ICONS.search }), search, clearSearch),
        sideBtn,
        gearBtn,
    );
    const canvas = h("canvas", { class: "board-canvas", role: "img", "aria-label": `Board ${source.name}` });
    const fitBtn = h("button", { class: "icon-btn float fit", "aria-label": "Show the whole board", html: ICONS.fit });
    const summary = h("div", { class: "summary", "aria-live": "polite" });
    const toggleBtn = h("button", { class: "icon-btn sheet-toggle", "aria-label": "Collapse or expand the parts list" });
    const head = h(
        "div",
        { class: "sheet-head" },
        h("div", { class: "grip", "aria-hidden": "true" }),
        h("div", { class: "sheet-row" }, summary, toggleBtn),
    );
    const list = h("ul", { class: "groups" });
    const sheetEl = h("section", { class: "sheet", "aria-label": "Parts" }, head, h("div", { class: "sheet-body" }, list));
    const stage = h("main", { class: "stage" }, canvas, fitBtn, sheetEl);
    const dialog = settingsDialog();
    root.replaceChildren(h("div", { class: "screen board-screen" }, topbar, stage, dialog));
    document.title = `${source.name} - human-pnp`;

    const view = new BoardView(canvas, board, parts, readPalette(), state);
    const sheet = new Sheet(stage, sheetEl, head);
    view.bottomInset = () => sheet.covered();
    sheet.onChange = () => {
        toggleBtn.innerHTML = sheet.collapsed ? ICONS.chevronUp : ICONS.chevronDown;
        view.redraw();
    };
    toggleBtn.innerHTML = ICONS.chevronDown;
    toggleBtn.addEventListener("click", () => sheet.toggle());
    fitBtn.addEventListener("click", () => view.fit(true));
    gearBtn.addEventListener("click", () => dialog.showModal());

    const count = (side: Side) => placeable.filter((p) => p.fp.side === side).length;
    setSide(count("B") > count("F") ? "B" : "F");
    sideBtn.addEventListener("click", () => setSide(view.side === "F" ? "B" : "F"));

    // --- Selection and search -------------------------------------------------

    function setSide(side: Side): void {
        view.setSide(side);
        sideBtn.innerHTML = `${ICONS.flip}<span>${side === "F" ? "Top" : "Bottom"}</span>`;
        sideBtn.setAttribute("aria-label", `Showing the ${SIDE_NAME[side]} side; turn the board over`);
        renderList();
        renderSummary();
    }

    // Show some parts: turn the board over when none are on this side.
    function reveal(ps: Part[]): void {
        if (!ps.length) return;
        if (!ps.some((p) => p.fp.side === view.side)) setSide(ps[0]!.fp.side);
        view.showParts(ps.filter((p) => p.fp.side === view.side));
    }

    function select(g: Group | null, focus: Part | null = null, fromList = false): void {
        selected = g;
        related = g ? relatedGroups(groups, g, settings.looseRatings, settings.matchFootprint) : [];
        state.highlight = new Set(related.flatMap((r) => r.parts));
        state.focus = focus;
        renderList();
        renderSummary();
        view.redraw();
        if (!g) return;
        if (fromList) {
            reveal([...state.highlight]);
        } else {
            const row = list.querySelector(`li.group[data-key="${CSS.escape(g.key)}"]`);
            row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }

    view.onTap = (part) => {
        if (!part) {
            if (selected || state.focus) select(null);
            return;
        }
        const g = groupOf.get(part) ?? null;
        if (g && g === selected) {
            state.focus = part;
            renderSummary();
            view.redraw();
        } else {
            select(g, part);
        }
    };

    function runSearch(): void {
        const q = terms(search.value);
        clearSearch.hidden = search.value.length === 0;
        if (!q.length) {
            hits = null;
            state.search = null;
        } else {
            // A term that reads as the same quantity as a part's value (100n
            // for 0.1uF, 4k7 for 4.7k) is as good as an exact match.
            const sameQuantity = (p: Part) => (term: string) =>
                p.value.num !== undefined && parseValue(term, p.kind).base === p.value.base ? 25 : 0;
            const kept = topMatches(
                placeable.map((p) => [p, matchFields(q, fields.get(p)!, sameQuantity(p))] as [Part, number]),
            );
            hits = new Map(kept);
            state.search = new Set(hits.keys());
        }
        renderList();
        renderSummary();
        view.redraw();
    }

    search.addEventListener("input", runSearch);
    search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            search.blur();
            if (hits) reveal([...hits.keys()]);
        } else if (e.key === "Escape") {
            search.value = "";
            runSearch();
        }
    });
    clearSearch.addEventListener("click", () => {
        search.value = "";
        runSearch();
        search.focus();
    });

    function setPlaced(refs: string[], on: boolean): void {
        for (const r of refs) {
            if (on) placed.add(r);
            else placed.delete(r);
        }
        savePlaced(source.key, placed);
        renderList();
        renderSummary();
        view.redraw();
    }

    // --- Rendering ----------------------------------------------------------------

    function setSummary(...nodes: (Node | null)[]): void {
        summary.replaceChildren(...nodes.filter((n): n is Node => n !== null));
    }

    function renderSummary(): void {
        const other = view.side === "F" ? "B" : "F";
        const flipChip = (n: number) =>
            n
                ? h(
                      "button",
                      { class: "chip", title: `Show the ${SIDE_NAME[other]} side`, onclick: () => setSide(other) },
                      `${n} on ${SIDE_NAME[other]}`,
                  )
                : null;
        if (selected) {
            const all = [...state.highlight];
            const away = all.filter((p) => p.fp.side !== view.side).length;
            const f = state.focus?.fp;
            setSummary(
                h(
                    "div",
                    { class: "sum-text" },
                    h("div", { class: "sum-main" }, h("b", {}, selected.label || "(no value)"), ` ${KIND_INFO[selected.kind].label}`),
                    h(
                        "div",
                        { class: "sum-sub" },
                        `${plural(all.length, "part")}${related.length > 1 ? ` in ${related.length} values` : ""}` +
                            (f ? ` - ${f.ref}` : ""),
                    ),
                ),
                flipChip(away),
                h("button", {
                    class: "icon-btn small",
                    "aria-label": "Clear selection",
                    html: ICONS.close,
                    onclick: () => select(null),
                }),
            );
        } else if (hits) {
            const away = [...hits.keys()].filter((p) => p.fp.side !== view.side).length;
            setSummary(
                h(
                    "div",
                    { class: "sum-text" },
                    h("div", { class: "sum-main" }, h("b", {}, plural(hits.size, "match").replace("matchs", "matches"))),
                    h("div", { class: "sum-sub" }, `for "${search.value.trim()}"`),
                ),
                flipChip(away),
            );
        } else {
            const todo = placeable.filter((p) => !p.dnp);
            const done = todo.filter((p) => placed.has(p.fp.ref)).length;
            const values = groups.filter((g) => !g.dnp).length;
            setSummary(
                h(
                    "div",
                    { class: "sum-text" },
                    h("div", { class: "sum-main" }, h("b", {}, source.name)),
                    h("div", { class: "sum-sub" }, `${plural(todo.length, "part")}, ${plural(values, "value")}, ${done} placed`),
                ),
            );
        }
    }

    function groupRow(g: Group): HTMLElement {
        const n = g.parts.length;
        const done = g.parts.filter((p) => placed.has(p.fp.ref)).length;
        const isSel = g === selected;
        const cls = [
            "group",
            isSel && "selected",
            !isSel && related.includes(g) && "related",
            g.dnp && "dnp",
            done === n && "done",
        ]
            .filter(Boolean)
            .join(" ");
        const check = h("input", { type: "checkbox", class: "placed-check", "aria-label": `${g.label} placed` });
        check.checked = done === n;
        check.indeterminate = done > 0 && done < n;
        const refs = h("div", { class: "refs" });
        for (const p of g.parts) {
            const on = placed.has(p.fp.ref);
            const away = p.fp.side !== view.side;
            const hit = hits?.has(p) ?? false;
            if (isSel) {
                refs.append(
                    h(
                        "button",
                        {
                            class: `ref-chip${on ? " on" : ""}${away ? " away" : ""}${p === state.focus ? " focus" : ""}`,
                            "data-ref": p.fp.ref,
                            "aria-pressed": String(on),
                            title: away ? `On the ${SIDE_NAME[p.fp.side]}` : undefined,
                        },
                        p.fp.ref,
                    ),
                );
            } else {
                refs.append(h("span", { class: `ref${hit ? " hit" : ""}${on ? " on" : ""}${away ? " away" : ""}` }, p.fp.ref), " ");
            }
        }
        return h(
            "li",
            { class: cls, "data-key": g.key },
            h("span", { class: "sym-wrap", html: symbolSvg(g.kind) }),
            h(
                "div",
                { class: "g-main" },
                h(
                    "div",
                    { class: "g-line" },
                    h("span", { class: "g-value" }, g.label || "(no value)"),
                    h("span", { class: "g-count" }, done ? `${done}/${n}` : String(n)),
                    h("span", { class: "g-pkg" }, g.pkg),
                ),
                refs,
                isSel ? h("div", { class: "g-hint" }, "Tap a reference to mark it placed") : null,
            ),
            h("label", { class: "check-wrap" }, check),
        );
    }

    function renderList(): void {
        const best = (g: Group) => Math.max(...g.parts.map((p) => hits?.get(p) ?? 0));
        const shown = hits
            ? groups.filter((g) => g.parts.some((p) => hits!.has(p))).sort((a, b) => best(b) - best(a))
            : groups;
        const items: HTMLElement[] = [];
        let section = "";
        for (const g of shown) {
            const name = g.dnp ? "Do not place" : KIND_INFO[g.kind].label;
            if (!hits && name !== section) {
                items.push(h("li", { class: "section" }, name));
                section = name;
            }
            items.push(groupRow(g));
        }
        if (!shown.length) {
            items.push(h("li", { class: "empty" }, hits ? "No parts match." : "No parts to place on this board."));
        }
        list.replaceChildren(...items);
    }

    list.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        const li = t.closest<HTMLElement>("li.group");
        const g = li ? groupByKey.get(li.dataset.key ?? "") : undefined;
        if (!g || t.closest(".check-wrap")) return;
        const chip = t.closest<HTMLElement>(".ref-chip");
        if (chip) {
            const ref = chip.dataset.ref ?? "";
            setPlaced([ref], !placed.has(ref));
            return;
        }
        select(g === selected ? null : g, null, true);
    });
    list.addEventListener("change", (e) => {
        const t = e.target as HTMLInputElement;
        if (!t.classList.contains("placed-check")) return;
        const g = groupByKey.get(t.closest<HTMLElement>("li.group")?.dataset.key ?? "");
        if (g) setPlaced(g.parts.map((p) => p.fp.ref), t.checked);
    });

    // --- Settings -------------------------------------------------------------------

    function settingsDialog(): HTMLDialogElement {
        const toggle = (key: keyof Settings, title: string, note?: string) => {
            const input = h("input", { type: "checkbox", name: key, role: "switch" });
            input.checked = settings[key] as boolean;
            return h("label", { class: "setting" }, input, h("span", {}, title, note ? h("small", {}, note) : null));
        };
        const themes = (["auto", "light", "dark"] as Theme[]).map((t) => {
            const input = h("input", { type: "radio", name: "theme", value: t });
            input.checked = settings.theme === t;
            return h("label", { class: "seg" }, input, h("span", {}, t[0]!.toUpperCase() + t.slice(1)));
        });
        const clearBtn = h("button", { type: "button", class: "btn danger" }, "Clear placed marks");
        const form = h(
            "form",
            { method: "dialog" },
            h("h2", {}, "Settings"),
            toggle("looseRatings", "Match unspecified ratings", "1uF also lights up 1uF 25V and 1uF 50V"),
            toggle("matchFootprint", "Match footprint too", "A 10k 0402 and a 10k 0603 count as different parts"),
            toggle("showPads", "Show pads"),
            toggle("showLabels", "Show references and values"),
            h("fieldset", { class: "themes" }, h("legend", {}, "Theme"), ...themes),
            clearBtn,
            source.link ? h("p", { class: "source" }, h("a", { href: source.link, target: "_blank", rel: "noopener" }, "Board file on GitHub")) : null,
            h("div", { class: "dialog-actions" }, h("button", { class: "btn primary", value: "done" }, "Done")),
        );
        form.addEventListener("change", (e) => {
            const t = e.target as HTMLInputElement;
            if (t.name === "theme") {
                settings.theme = t.value as Theme;
                applyTheme(settings.theme);
                view.palette = readPalette();
            } else if (t.name in settings) {
                (settings as unknown as Record<string, boolean>)[t.name] = t.checked;
            }
            saveSettings(settings);
            state.showPads = settings.showPads;
            state.showLabels = settings.showLabels;
            if (t.name === "matchFootprint") {
                const keep = state.focus ?? selected?.parts[0] ?? null;
                groups = buildGroups(parts, settings.matchFootprint);
                indexGroups();
                select(keep ? (groupOf.get(keep) ?? null) : null, state.focus);
            } else if (t.name === "looseRatings") {
                select(selected, state.focus);
            } else {
                view.redraw();
            }
        });
        let armed = false;
        clearBtn.addEventListener("click", () => {
            if (!armed) {
                armed = true;
                clearBtn.textContent = "Tap again to clear every mark";
                return;
            }
            armed = false;
            clearBtn.textContent = "Clear placed marks";
            setPlaced([...placed], false);
        });
        const d = h("dialog", { class: "settings" }, form);
        d.addEventListener("close", () => {
            armed = false;
            clearBtn.textContent = "Clear placed marks";
        });
        // Close when the backdrop is tapped.
        d.addEventListener("click", (e) => {
            if (e.target === d) d.close();
        });
        return d;
    }

    // Follow the system theme while on "auto".
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
        view.palette = readPalette();
        view.redraw();
    };
    media.addEventListener("change", onScheme);
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && document.activeElement !== search && !dialog.open && (selected || state.focus)) select(null);
    };
    document.addEventListener("keydown", onKey);

    renderList();
    renderSummary();
    // Read-only handle for debugging in the console and for the browser
    // checks (scripts/e2e.ts).
    (window as unknown as { humanPnp: unknown }).humanPnp = { view, parts, groups: () => groups };

    return () => {
        view.destroy();
        sheet.destroy();
        media.removeEventListener("change", onScheme);
        document.removeEventListener("keydown", onKey);
        if (dialog.open) dialog.close();
    };
}
