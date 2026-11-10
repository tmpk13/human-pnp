// App entry: reads the address (?gh=owner/repo&ref=..&path=..) and shows
// the home screen, the list of boards in a repository, or a board.

import { applyTheme, showBoard, type BoardSource } from "./boardscreen";
import { boardName, formatBytes, h, ICONS, nextPaint } from "./dom";
import {
    fetchBoard,
    GhError,
    githubUrl,
    isBoardPath,
    listBoards,
    parseGithubInput,
    type Listing,
    type RepoTarget,
} from "./github";
import { BoardError, parseBoard, type Board } from "./kicad";
import { addRecent, loadRecents, loadSettings } from "./store";

const app = document.getElementById("app")!;
const settings = loadSettings();
applyTheme(settings.theme);

let teardown: (() => void) | null = null;
// Each route() call takes a ticket; async work for an older ticket stops.
let ticket = 0;

const DEMO = "?gh=KiCad/kicad-source-mirror&ref=master&path=demos";

function paramsFor(t: RepoTarget): string {
    const q = new URLSearchParams({ gh: `${t.owner}/${t.repo}` });
    if (t.ref) q.set("ref", t.ref);
    if (t.path) q.set("path", t.path);
    if (t.refPath) q.set("rp", t.refPath);
    return `?${q.toString().replace(/%2F/g, "/")}`;
}

// Entries this app pushed carry { app: true }, so Back can tell whether the
// previous page is the app's own or another site (a shared link).
function go(search: string, replace = false): void {
    if (replace) history.replaceState(history.state, "", search || location.pathname);
    else history.pushState({ app: true }, "", search || location.pathname);
    void route();
}

// The in-app Back button: back through the app's own pages, else home.
function back(): void {
    if ((history.state as { app?: boolean } | null)?.app) history.back();
    else go("");
}

function targetFromAddress(): RepoTarget | null {
    const q = new URLSearchParams(location.search);
    const gh = q.get("gh");
    if (!gh) return null;
    const [owner = "", repo = ""] = gh.split("/");
    if (!owner || !repo) return null;
    const t: RepoTarget = { owner, repo };
    const ref = q.get("ref");
    const path = q.get("path");
    const rp = q.get("rp");
    if (ref) t.ref = ref;
    if (path) t.path = path;
    if (rp) t.refPath = rp;
    return t;
}

async function route(): Promise<void> {
    const mine = ++ticket;
    teardown?.();
    teardown = null;
    document.title = "human-pnp";
    const t = targetFromAddress();
    if (!t) return showHome();
    if (isBoardPath(t.path) || (!t.path && isBoardPath(t.refPath))) return openBoard(t, mine);
    return showListing(t, mine);
}

// --- Screens -------------------------------------------------------------

function topbar(title: string, onBack: () => void): HTMLElement {
    return h(
        "header",
        { class: "topbar" },
        h("button", { class: "icon-btn", "aria-label": "Back", html: ICONS.back, onclick: onBack }),
        h("div", { class: "topbar-title" }, title),
    );
}

function showStatus(title: string, message: string, onBack: () => void): HTMLElement {
    const msg = h("p", { class: "status-text" }, message);
    app.replaceChildren(
        h(
            "div",
            { class: "screen" },
            topbar(title, onBack),
            h("main", { class: "page status" }, h("div", { class: "spinner", "aria-hidden": "true" }), msg),
        ),
    );
    return msg;
}

function showError(title: string, err: unknown, onBack: () => void): void {
    const message =
        err instanceof GhError || err instanceof BoardError ? err.message : `Something went wrong: ${String(err)}`;
    app.replaceChildren(
        h(
            "div",
            { class: "screen" },
            topbar(title, onBack),
            h(
                "main",
                { class: "page status" },
                h("p", { class: "error" }, message),
                h("button", { class: "btn primary", onclick: () => go("") }, "Open another board"),
            ),
        ),
    );
}

function showHome(): void {
    const input = h("input", {
        id: "gh-link",
        type: "text",
        inputmode: "url",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        placeholder: "github.com/owner/repo",
        enterkeyhint: "go",
    });
    const error = h("p", { class: "error", role: "alert" });
    error.hidden = true;
    const form = h(
        "form",
        { class: "open-form" },
        h("label", { for: "gh-link" }, "GitHub link"),
        h("div", { class: "row" }, input, h("button", { class: "btn primary", type: "submit" }, "Open")),
        h("p", { class: "hint" }, "A repository, a folder in one, or a .kicad_pcb file."),
        error,
    );
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const t = parseGithubInput(input.value);
        if (!t) {
            error.textContent = "That does not look like a GitHub repository link.";
            error.hidden = false;
            return;
        }
        go(paramsFor(t));
    });

    const file = h("input", { type: "file", accept: ".kicad_pcb", class: "visually-hidden" });
    file.addEventListener("change", () => {
        const f = file.files?.[0];
        if (f) void openLocal(f);
    });

    const recents = loadRecents();
    app.replaceChildren(
        h(
            "div",
            { class: "screen" },
            h(
                "main",
                { class: "page home" },
                h(
                    "header",
                    { class: "home-head" },
                    h("span", { class: "logo", html: ICONS.board }),
                    h("h1", {}, "human-pnp"),
                    h(
                        "p",
                        {},
                        "Place parts on a KiCad board by hand: see where each part goes, its value and which way it faces, " +
                            "light up every part of the same value, and tick them off as you go.",
                    ),
                ),
                form,
                h("label", { class: "btn file-btn" }, h("span", { html: ICONS.upload }), "Open a .kicad_pcb file", file),
                recents.length
                    ? h(
                          "section",
                          { class: "recents" },
                          h("h2", {}, "Recent"),
                          h(
                              "ul",
                              { class: "files" },
                              ...recents.map((r) =>
                                  fileItem(
                                      boardName(r.path),
                                      `${r.owner}/${r.repo}`,
                                      paramsFor({ owner: r.owner, repo: r.repo, ref: r.ref, path: r.path }),
                                  ),
                              ),
                          ),
                      )
                    : null,
                h(
                    "section",
                    { class: "recents" },
                    h("h2", {}, "Try it"),
                    h("ul", { class: "files" }, fileItem("KiCad demo boards", "KiCad/kicad-source-mirror", DEMO)),
                ),
            ),
        ),
    );
}

function fileItem(name: string, detail: string, href: string): HTMLElement {
    const a = h(
        "a",
        { class: "file", href },
        h("span", { class: "file-icon", html: ICONS.file }),
        h("span", { class: "file-text" }, h("span", { class: "file-name" }, name), h("span", { class: "file-detail" }, detail)),
    );
    a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(href);
    });
    return h("li", {}, a);
}

async function showListing(t: RepoTarget, mine: number): Promise<void> {
    const title = `${t.owner}/${t.repo}`;
    showStatus(title, `Looking for boards in ${title}...`, back);
    let listing: Listing;
    try {
        listing = await listBoards(t);
    } catch (e) {
        if (mine === ticket) showError(title, e, back);
        return;
    }
    if (mine !== ticket) return;
    const resolved: RepoTarget = { owner: t.owner, repo: t.repo, ref: listing.ref };
    if (listing.base) resolved.path = listing.base;
    if (listing.files.length === 1) {
        go(paramsFor({ ...resolved, path: listing.files[0]!.path }), true);
        return;
    }
    history.replaceState(history.state, "", paramsFor(resolved));
    const where = listing.base ? `${title}/${listing.base}` : title;
    const notes: HTMLElement[] = [];
    if (listing.truncated) {
        notes.push(
            h("p", { class: "note" }, "This repository is too large for GitHub to list in full. Link to the folder that holds the board to see everything."),
        );
    }
    if (listing.via === "jsdelivr") {
        notes.push(h("p", { class: "note" }, `GitHub's hourly limit is used up, so this list comes from jsDelivr (branch ${listing.ref}).`));
    }
    app.replaceChildren(
        h(
            "div",
            { class: "screen" },
            topbar(title, back),
            h(
                "main",
                { class: "page listing" },
                listing.files.length
                    ? h("h2", {}, `${listing.files.length} boards in ${where}`)
                    : h("p", { class: "error" }, `No .kicad_pcb files in ${where}.`),
                ...notes,
                h(
                    "ul",
                    { class: "files" },
                    ...listing.files.map((f) => {
                        const folder = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
                        const detail = [folder, f.size ? formatBytes(f.size) : ""].filter(Boolean).join(" - ");
                        return fileItem(boardName(f.path), detail, paramsFor({ ...resolved, path: f.path }));
                    }),
                ),
                h("p", { class: "note" }, h("a", { href: githubUrl(t.owner, t.repo), target: "_blank", rel: "noopener" }, "Open on GitHub")),
            ),
        ),
    );
}

async function openBoard(t: RepoTarget, mine: number): Promise<void> {
    const name = boardName(t.path ?? t.refPath ?? "");
    const msg = showStatus(name, `Downloading ${name}...`, back);
    let text: string;
    let ref: string;
    let path: string;
    try {
        const got = await fetchBoard(t, (n) => {
            if (mine === ticket) msg.textContent = `Downloading ${name}... ${formatBytes(n)}`;
        });
        ({ text, ref, path } = got);
    } catch (e) {
        if (mine === ticket) showError(name, e, back);
        return;
    }
    if (mine !== ticket) return;
    msg.textContent = `Reading ${name}...`;
    await nextPaint();
    if (mine !== ticket) return;
    let board: Board;
    try {
        board = parseBoard(text);
    } catch (e) {
        showError(name, e, back);
        return;
    }
    if (t.refPath) history.replaceState(history.state, "", paramsFor({ owner: t.owner, repo: t.repo, ref, path }));
    addRecent({ owner: t.owner, repo: t.repo, ref, path });
    const source: BoardSource = {
        name,
        where: `${t.owner}/${t.repo}`,
        key: `${t.owner}/${t.repo}/${path}`.toLowerCase(),
        link: githubUrl(t.owner, t.repo, ref, path),
    };
    teardown = showBoard(app, board, source, settings, back);
}

async function openLocal(f: File): Promise<void> {
    const name = boardName(f.name);
    history.pushState({ app: true }, "", "?local");
    const mine = ++ticket;
    const msg = showStatus(name, `Reading ${name}...`, () => history.back());
    await nextPaint();
    let board: Board;
    try {
        board = parseBoard(await f.text());
    } catch (e) {
        if (mine === ticket) showError(name, e, () => history.back());
        return;
    }
    if (mine !== ticket) return;
    msg.textContent = "";
    teardown = showBoard(app, board, { name, where: "Local file", key: `local:${f.name}` }, settings, () => history.back());
}

window.addEventListener("popstate", () => void route());
void route();
