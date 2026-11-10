import { describe, expect, test } from "bun:test";
import {
    fetchBoard,
    fetchFile,
    GhError,
    githubUrl,
    listBoards,
    parseGithubInput,
    rawUrl,
    refSplits,
    type Fetch,
} from "../src/github";

// A fetch that answers from a table of URL -> response and records calls.
function fakeFetch(routes: Record<string, () => Response>): Fetch & { calls: string[] } {
    const calls: string[] = [];
    const f = (async (url: string) => {
        calls.push(url);
        const route = routes[url];
        return route ? route() : new Response("Not Found", { status: 404 });
    }) as Fetch & { calls: string[] };
    f.calls = calls;
    return f;
}

const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const tree = (paths: string[], truncated = false) =>
    json({ tree: paths.map((path) => ({ path, type: "blob", size: 10 })), truncated });
const rateLimited = () =>
    new Response('{"message":"API rate limit exceeded for 1.2.3.4."}', {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
    });

describe("parseGithubInput", () => {
    test("reads the usual ways of naming a repository", () => {
        const plain = { owner: "foostan", repo: "crkbd" };
        expect(parseGithubInput("foostan/crkbd")).toEqual(plain);
        expect(parseGithubInput("  https://github.com/foostan/crkbd  ")).toEqual(plain);
        expect(parseGithubInput("github.com/foostan/crkbd/")).toEqual(plain);
        expect(parseGithubInput("https://www.github.com/foostan/crkbd.git")).toEqual(plain);
        expect(parseGithubInput("git@github.com:foostan/crkbd.git")).toEqual(plain);
        expect(parseGithubInput("https://github.com/foostan/crkbd/issues/12")).toEqual(plain);
        expect(parseGithubInput("https://github.com/foostan/crkbd?tab=readme")).toEqual(plain);
    });

    test("keeps folder and file links whole until the ref is known", () => {
        expect(parseGithubInput("https://github.com/o/r/tree/main/hw/sonde%20xilinx")).toEqual({
            owner: "o",
            repo: "r",
            refPath: "main/hw/sonde xilinx",
        });
        expect(parseGithubInput("https://github.com/o/r/blob/v1.2/board.kicad_pcb#L10")).toEqual({
            owner: "o",
            repo: "r",
            refPath: "v1.2/board.kicad_pcb",
        });
        expect(parseGithubInput("https://raw.githubusercontent.com/o/r/main/a/b.kicad_pcb")).toEqual({
            owner: "o",
            repo: "r",
            refPath: "main/a/b.kicad_pcb",
        });
        expect(parseGithubInput("https://raw.githubusercontent.com/o/r/refs/heads/feat/x/b.kicad_pcb")).toEqual({
            owner: "o",
            repo: "r",
            ref: "feat",
            path: "x/b.kicad_pcb",
        });
    });

    test("rejects what is not a GitHub repository", () => {
        expect(parseGithubInput("")).toBeNull();
        expect(parseGithubInput("https://gitlab.com/o/r")).toBeNull();
        expect(parseGithubInput("https://github.com/o")).toBeNull();
        expect(parseGithubInput("just words")).toBeNull();
    });
});

describe("urls", () => {
    test("refSplits tries the shortest ref first", () => {
        expect(refSplits("feat/x/hw")).toEqual([
            { ref: "feat", path: "x/hw" },
            { ref: "feat/x", path: "hw" },
            { ref: "feat/x/hw", path: "" },
        ]);
    });

    test("paths are encoded per segment", () => {
        expect(rawUrl("o", "r", "HEAD", "sonde xilinx/a#b.kicad_pcb")).toBe(
            "https://raw.githubusercontent.com/o/r/HEAD/sonde%20xilinx/a%23b.kicad_pcb",
        );
        expect(githubUrl("o", "r", "main", "a/b.kicad_pcb")).toBe("https://github.com/o/r/blob/main/a/b.kicad_pcb");
        expect(githubUrl("o", "r")).toBe("https://github.com/o/r");
    });
});

describe("listBoards", () => {
    test("lists boards from the git tree, shallow first, without autosaves", async () => {
        const f = fakeFetch({
            "https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1": tree([
                "README.md",
                "pcb/main/main.kicad_pcb",
                "pcb/main/_autosave-main.kicad_pcb",
                "top.kicad_pcb",
                "lib/x.kicad_mod",
            ]),
        });
        const l = await listBoards({ owner: "o", repo: "r" }, f);
        expect(l.files.map((x) => x.path)).toEqual(["top.kicad_pcb", "pcb/main/main.kicad_pcb"]);
        expect(l.ref).toBe("HEAD");
        expect(l.via).toBe("github");
    });

    test("finds where a slashed branch name ends", async () => {
        const f = fakeFetch({
            "https://api.github.com/repos/o/r/git/trees/feat/x:hw?recursive=1": tree(["a.kicad_pcb"]),
        });
        const l = await listBoards({ owner: "o", repo: "r", refPath: "feat/x/hw" }, f);
        expect(l.ref).toBe("feat/x");
        expect(l.base).toBe("hw");
        expect(l.files.map((x) => x.path)).toEqual(["hw/a.kicad_pcb"]);
        expect(f.calls[0]).toBe("https://api.github.com/repos/o/r/git/trees/feat:x/hw?recursive=1");
    });

    test("falls back to jsDelivr when the API limit is used up", async () => {
        const f = fakeFetch({
            "https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1": rateLimited,
            "https://data.jsdelivr.com/v1/packages/gh/o/r@master?structure=flat": json({
                files: [{ name: "/hw/b.kicad_pcb", size: 5 }, { name: "/README.md" }],
            }),
        });
        const l = await listBoards({ owner: "o", repo: "r" }, f);
        expect(l.via).toBe("jsdelivr");
        expect(l.ref).toBe("master");
        expect(l.files).toEqual([{ path: "hw/b.kicad_pcb", size: 5 }]);
    });

    test("says so when both GitHub and the mirror fail", async () => {
        const f = fakeFetch({ "https://api.github.com/repos/o/r/git/trees/HEAD?recursive=1": rateLimited });
        const err = await listBoards({ owner: "o", repo: "r" }, f).catch((e) => e);
        expect(err).toBeInstanceOf(GhError);
        expect((err as GhError).code).toBe("rate_limited");
    });

    test("reports a missing repository", async () => {
        const err = await listBoards({ owner: "o", repo: "nope" }, fakeFetch({})).catch((e) => e);
        expect((err as GhError).code).toBe("not_found");
    });

    test("reports network failures", async () => {
        const f = (async () => {
            throw new TypeError("Failed to fetch");
        }) as Fetch;
        const err = await listBoards({ owner: "o", repo: "r" }, f).catch((e) => e);
        expect((err as GhError).code).toBe("network");
    });
});

describe("fetching boards", () => {
    test("a blob link is fetched in one request, ref split or not", async () => {
        const f = fakeFetch({
            "https://raw.githubusercontent.com/o/r/feat/x/b.kicad_pcb": () => new Response("(kicad_pcb)"),
        });
        const got = await fetchBoard({ owner: "o", repo: "r", refPath: "feat/x/b.kicad_pcb" }, undefined, f);
        expect(got.text).toBe("(kicad_pcb)");
        expect(f.calls.length).toBe(1);
        const missing = await fetchBoard({ owner: "o", repo: "r", refPath: "main/no.kicad_pcb" }, undefined, f).catch(
            (e) => e,
        );
        expect((missing as GhError).code).toBe("not_found");
    });

    test("follows Git LFS pointers", async () => {
        const f = fakeFetch({
            "https://raw.githubusercontent.com/o/r/HEAD/b.kicad_pcb": () =>
                new Response("version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 11\n"),
            "https://media.githubusercontent.com/media/o/r/HEAD/b.kicad_pcb": () => new Response("(kicad_pcb)"),
        });
        expect(await fetchFile("o", "r", "HEAD", "b.kicad_pcb", undefined, f)).toBe("(kicad_pcb)");
    });

    test("reports download progress in bytes", async () => {
        const f = fakeFetch({
            "https://raw.githubusercontent.com/o/r/HEAD/b.kicad_pcb": () => new Response("(kicad_pcb (version 1))"),
        });
        const seen: number[] = [];
        await fetchFile("o", "r", "HEAD", "b.kicad_pcb", (n) => seen.push(n), f);
        expect(seen[seen.length - 1]).toBe(23);
    });

    test("a link to something other than a board is refused", async () => {
        const err = await fetchBoard({ owner: "o", repo: "r", refPath: "main/README.md" }, undefined, fakeFetch({})).catch(
            (e) => e,
        );
        expect((err as GhError).code).toBe("bad_input");
    });
});
