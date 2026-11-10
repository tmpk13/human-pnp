// Finding and downloading .kicad_pcb files in public GitHub repositories,
// straight from the browser.
//
// Listing a repository costs one GitHub API call (the git tree, recursive).
// Unauthenticated callers get 60 API calls an hour per IP address, and
// phone networks often share one address among many users, so when the
// limit is used up the listing comes from jsDelivr's GitHub mirror instead.
// File contents come from raw.githubusercontent.com, which has no such
// limit. All three send CORS headers that allow any page to read them.

export interface RepoTarget {
    owner: string;
    repo: string;
    // Branch, tag or commit, when known.
    ref?: string;
    // Folder or .kicad_pcb file inside the repository (with ref).
    path?: string;
    // "<ref>/<path>" from a tree or blob link: branch names may contain
    // slashes, so where the ref ends is found by asking GitHub.
    refPath?: string;
}

export interface PcbFile {
    path: string;
    size?: number;
}

export interface Listing {
    owner: string;
    repo: string;
    ref: string;
    // Folder the listing covers ("" for the whole repository).
    base: string;
    files: PcbFile[];
    // GitHub cut the listing short (very large repositories).
    truncated: boolean;
    via: "github" | "jsdelivr";
}

export type GhErrorCode = "bad_input" | "not_found" | "rate_limited" | "empty" | "network" | "http";

export class GhError extends Error {
    constructor(
        public code: GhErrorCode,
        message: string,
    ) {
        super(message);
    }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const NAME = /^[A-Za-z0-9_.-]+$/;

function decodeSegment(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

// Encode a path for a URL, keeping its slashes.
export function encodePath(p: string): string {
    return p
        .split("/")
        .filter((s) => s.length > 0)
        .map(encodeURIComponent)
        .join("/");
}

// Read what a person pasted: owner/repo, a github.com link to a repository,
// folder or file, a raw.githubusercontent.com link, or an SSH remote.
export function parseGithubInput(input: string): RepoTarget | null {
    let s = input.trim();
    if (!s) return null;
    const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(s);
    if (ssh) return checkNames({ owner: ssh[1]!, repo: ssh[2]! });
    const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(s);
    if (short && !s.includes(".com")) return checkNames({ owner: short[1]!, repo: short[2]! });
    if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
    let url: URL;
    try {
        url = new URL(s);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    const segs = url.pathname.split("/").filter((x) => x.length > 0).map(decodeSegment);
    if (segs.length < 2) return null;
    const owner = segs[0]!;
    const repo = segs[1]!.replace(/\.git$/, "");
    if (host === "github.com" || host === "www.github.com") {
        const mode = segs[2];
        const rest = segs.slice(3);
        if ((mode === "tree" || mode === "blob" || mode === "raw") && rest.length) {
            return checkNames({ owner, repo, refPath: rest.join("/") });
        }
        return checkNames({ owner, repo });
    }
    if (host === "raw.githubusercontent.com") {
        const rest = segs.slice(2);
        if (rest[0] === "refs" && (rest[1] === "heads" || rest[1] === "tags") && rest.length > 3) {
            return checkNames({ owner, repo, ref: rest[2]!, path: rest.slice(3).join("/") });
        }
        return rest.length ? checkNames({ owner, repo, refPath: rest.join("/") }) : null;
    }
    return null;
}

function checkNames(t: RepoTarget): RepoTarget | null {
    return NAME.test(t.owner) && NAME.test(t.repo) ? t : null;
}

export function isBoardPath(p: string | undefined): boolean {
    return !!p && /\.kicad_pcb$/i.test(p);
}

// Every way to split "a/b/c" into a ref and a path, shortest ref first.
export function refSplits(refPath: string): { ref: string; path: string }[] {
    const segs = refPath.split("/").filter((s) => s.length > 0);
    const out: { ref: string; path: string }[] = [];
    for (let k = 1; k <= segs.length; k++) {
        out.push({ ref: segs.slice(0, k).join("/"), path: segs.slice(k).join("/") });
    }
    return out;
}

export function rawUrl(owner: string, repo: string, ref: string, path: string): string {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${encodePath(ref)}/${encodePath(path)}`;
}

export function githubUrl(owner: string, repo: string, ref?: string, path?: string): string {
    const base = `https://github.com/${owner}/${repo}`;
    if (!ref || ref === "HEAD") return path ? `${base}/blob/HEAD/${encodePath(path)}` : base;
    return path ? `${base}/blob/${encodePath(ref)}/${encodePath(path)}` : `${base}/tree/${encodePath(ref)}`;
}

function keepBoard(path: string): boolean {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return isBoardPath(path) && !name.startsWith("_autosave-");
}

function sortFiles(files: PcbFile[]): PcbFile[] {
    const depth = (p: string) => p.split("/").length;
    return files.sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
}

async function get(fetchFn: Fetch, url: string): Promise<Response> {
    try {
        return await fetchFn(url);
    } catch (e) {
        throw new GhError("network", `Could not reach ${new URL(url).hostname} (${(e as Error).message}).`);
    }
}

async function isRateLimited(res: Response): Promise<boolean> {
    if (res.status !== 403 && res.status !== 429) return false;
    if (res.headers.get("x-ratelimit-remaining") === "0") return true;
    try {
        const body = await res.clone().text();
        return /rate limit/i.test(body);
    } catch {
        return false;
    }
}

interface TreeEntry {
    path: string;
    type: string;
    size?: number;
}

async function listViaGithub(
    fetchFn: Fetch,
    owner: string,
    repo: string,
    candidates: { ref: string; path: string }[],
): Promise<Listing | "rate_limited" | "not_found"> {
    for (const { ref, path } of candidates) {
        const treeish = path ? `${encodePath(ref)}:${encodePath(path)}` : encodePath(ref);
        const res = await get(fetchFn, `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeish}?recursive=1`);
        if (res.ok) {
            const body = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
            const files = (body.tree ?? [])
                .filter((e) => e.type === "blob")
                .map((e) => ({ path: path ? `${path}/${e.path}` : e.path, size: e.size }))
                .filter((f) => keepBoard(f.path));
            return { owner, repo, ref, base: path, files: sortFiles(files), truncated: !!body.truncated, via: "github" };
        }
        if (await isRateLimited(res)) return "rate_limited";
        if (res.status === 409) throw new GhError("empty", `${owner}/${repo} is an empty repository.`);
        if (res.status !== 404 && res.status !== 422) {
            throw new GhError("http", `GitHub answered ${res.status} for ${owner}/${repo}.`);
        }
    }
    return "not_found";
}

async function listViaJsdelivr(
    fetchFn: Fetch,
    owner: string,
    repo: string,
    candidates: { ref: string; path: string }[],
): Promise<Listing | null> {
    for (const { ref, path } of candidates) {
        const res = await get(
            fetchFn,
            `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${encodeURIComponent(ref)}?structure=flat`,
        );
        if (!res.ok) continue;
        const body = (await res.json()) as { files?: { name: string; size?: number }[] };
        const prefix = path ? `${path}/` : "";
        const files = (body.files ?? [])
            .map((f) => ({ path: f.name.replace(/^\//, ""), size: f.size }))
            .filter((f) => f.path.startsWith(prefix) && keepBoard(f.path));
        return { owner, repo, ref, base: path, files: sortFiles(files), truncated: false, via: "jsdelivr" };
    }
    return null;
}

// List the .kicad_pcb files a target points into.
export async function listBoards(t: RepoTarget, fetchFn: Fetch = fetch): Promise<Listing> {
    const candidates = t.ref
        ? [{ ref: t.ref, path: t.path ?? "" }]
        : t.refPath
          ? refSplits(t.refPath)
          : [{ ref: "HEAD", path: "" }];
    const listed = await listViaGithub(fetchFn, t.owner, t.repo, candidates);
    if (typeof listed !== "string") return listed;
    if (listed === "not_found") {
        const where = t.path || t.refPath ? ` (${t.ref ? `${t.ref}/${t.path ?? ""}` : t.refPath})` : "";
        throw new GhError(
            "not_found",
            `Could not find ${t.owner}/${t.repo}${where} on GitHub. Is the repository public and the link right?`,
        );
    }
    // GitHub's API limit is used up: jsDelivr needs a branch name, so try
    // the given one or the usual default branches.
    const fallback = t.ref
        ? candidates
        : t.refPath
          ? candidates.filter((c) => c.ref !== "HEAD")
          : [
                { ref: "main", path: "" },
                { ref: "master", path: "" },
            ];
    const mirrored = await listViaJsdelivr(fetchFn, t.owner, t.repo, fallback);
    if (mirrored) return mirrored;
    throw new GhError(
        "rate_limited",
        "GitHub's hourly limit for listing repositories from your network is used up. " +
            "Paste a link straight to the .kicad_pcb file instead, or try again later.",
    );
}

const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";

async function readText(res: Response, onProgress?: (bytes: number) => void): Promise<string> {
    if (!res.body || !onProgress) return await res.text();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        onProgress(total);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.length;
    }
    return new TextDecoder("utf-8").decode(all);
}

// Download a file's text. Returns null when the file is not there (404).
export async function fetchFile(
    owner: string,
    repo: string,
    ref: string,
    path: string,
    onProgress?: (bytes: number) => void,
    fetchFn: Fetch = fetch,
): Promise<string | null> {
    const res = await get(fetchFn, rawUrl(owner, repo, ref, path));
    if (res.status === 404) return null;
    if (!res.ok) throw new GhError("http", `GitHub answered ${res.status} for ${path}.`);
    const text = await readText(res, onProgress);
    if (!text.startsWith(LFS_POINTER)) return text;
    // Stored with Git LFS: the raw file is only a pointer to the content.
    const media = `https://media.githubusercontent.com/media/${owner}/${repo}/${encodePath(ref)}/${encodePath(path)}`;
    const lfs = await get(fetchFn, media);
    if (!lfs.ok) throw new GhError("http", `Could not download ${path} from Git LFS (${lfs.status}).`);
    return await readText(lfs, onProgress);
}

export interface FetchedBoard {
    ref: string;
    path: string;
    text: string;
}

// Download the board a target names. A blob link's "<ref>/<path>" needs no
// splitting here: every split gives the same raw.githubusercontent.com URL
// and GitHub resolves the ref itself, so the first segment is reported as
// the ref.
export async function fetchBoard(
    t: RepoTarget,
    onProgress?: (bytes: number) => void,
    fetchFn: Fetch = fetch,
): Promise<FetchedBoard> {
    let ref: string;
    let path: string;
    if (t.path && isBoardPath(t.path)) {
        ref = t.ref ?? "HEAD";
        path = t.path;
    } else if (t.refPath && isBoardPath(t.refPath)) {
        const split = refSplits(t.refPath)[0]!;
        ref = split.ref;
        path = split.path;
    } else {
        throw new GhError("bad_input", "That link does not point to a .kicad_pcb file.");
    }
    const text = await fetchFile(t.owner, t.repo, ref, path, onProgress, fetchFn);
    if (text === null) throw new GhError("not_found", `Could not find ${path} in ${t.owner}/${t.repo}.`);
    return { ref, path, text };
}
