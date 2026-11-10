// Browser checks: the built site in headless Chromium at phone size, with
// GitHub answered from tests/data so no network is needed. Screenshots go to
// shots/. Run with `mise run e2e` (sets E2E=1 after building dist/).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const enabled = process.env.E2E === "1";
const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const shots = join(root, "shots");
const data = join(root, "tests", "data");

const TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".map": "application/json",
};

// A fake repository demo/boards holding two boards.
const TREE = {
    tree: [
        { path: "README.md", type: "blob", size: 10 },
        { path: "sample/sample.kicad_pcb", type: "blob", size: 218658 },
        { path: "legacy/legacy-k5.kicad_pcb", type: "blob", size: 9657 },
    ],
    truncated: false,
};

let server: ReturnType<typeof Bun.serve> | null = null;
let browser: Browser | null = null;
let base = "";

async function newPage(opts: Parameters<Browser["newContext"]>[0], errors: string[]): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser!.newContext(opts);
    await ctx.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (url === "https://api.github.com/repos/demo/boards/git/trees/HEAD?recursive=1") {
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TREE) });
        }
        const raw = "https://raw.githubusercontent.com/demo/boards/HEAD/";
        if (url === `${raw}sample/sample.kicad_pcb`) {
            return route.fulfill({ status: 200, body: readFileSync(join(data, "sample.kicad_pcb"), "utf8") });
        }
        if (url === `${raw}legacy/legacy-k5.kicad_pcb`) {
            return route.fulfill({ status: 200, body: readFileSync(join(data, "legacy-k5.kicad_pcb"), "utf8") });
        }
        errors.push(`unexpected request ${url}`);
        return route.abort();
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
    });
    return { ctx, page };
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(shots, `${name}.png`) });
const summary = (page: Page) => page.locator(".summary").innerText();

async function boardReady(page: Page): Promise<void> {
    await page.waitForFunction(() => (window as unknown as { humanPnp?: unknown }).humanPnp !== undefined);
    await page.waitForTimeout(150);
}

async function tapPart(page: Page, ref: string, touch = true): Promise<void> {
    const pos = await page.evaluate(
        (r) => (window as unknown as { humanPnp: { view: { screenPosOf(r: string): [number, number] | null } } }).humanPnp.view.screenPosOf(r),
        ref,
    );
    expect(pos, `${ref} on screen`).not.toBeNull();
    const box = (await page.locator("canvas.board-canvas").boundingBox())!;
    if (touch) await page.touchscreen.tap(box.x + pos![0], box.y + pos![1]);
    else await page.mouse.click(box.x + pos![0], box.y + pos![1]);
    await page.waitForTimeout(100);
}

async function zoomAt(page: Page, ref: string, steps: number): Promise<void> {
    const pos = await page.evaluate(
        (r) => (window as unknown as { humanPnp: { view: { screenPosOf(r: string): [number, number] | null } } }).humanPnp.view.screenPosOf(r),
        ref,
    );
    const box = (await page.locator("canvas.board-canvas").boundingBox())!;
    await page.mouse.move(box.x + pos![0], box.y + pos![1]);
    for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
}

describe.skipIf(!enabled)("site in Chromium", () => {
    beforeAll(async () => {
        mkdirSync(shots, { recursive: true });
        server = Bun.serve({
            port: 0,
            async fetch(req) {
                const path = new URL(req.url).pathname;
                if (!path.startsWith("/human-pnp/")) return new Response("not found", { status: 404 });
                const rel = path.slice("/human-pnp/".length) || "index.html";
                const file = Bun.file(join(dist, rel));
                if (!(await file.exists())) return new Response("not found", { status: 404 });
                return new Response(file, { headers: { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" } });
            },
        });
        base = `http://localhost:${server.port}/human-pnp/`;
        browser = await chromium.launch();
    });

    afterAll(async () => {
        await browser?.close();
        server?.stop(true);
    });

    test("phone: open a repository, pick a board, select, search, flip, mark placed", async () => {
        const errors: string[] = [];
        const { ctx, page } = await newPage(
            { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light" },
            errors,
        );
        await page.goto(base);
        await page.locator("#gh-link").waitFor();
        await shot(page, "01-home");

        await page.fill("#gh-link", "https://github.com/demo/boards");
        await page.click("button[type=submit]");
        await page.locator(".files .file").first().waitFor();
        expect(await page.locator(".listing .files .file").count()).toBe(2);
        expect(page.url()).toContain("gh=demo/boards&ref=HEAD");
        await shot(page, "02-listing");

        await page.locator(".file", { hasText: "sample" }).click();
        await boardReady(page);
        expect(page.url()).toContain("path=sample/sample.kicad_pcb");
        expect(await summary(page)).toContain("48 parts");
        await shot(page, "03-board");

        // No sideways scrolling at phone width.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        // Tap C7 (1uF): loose matching lights up 1uF, 1uF 25V and 1uF 50V.
        await tapPart(page, "C7");
        let s = await summary(page);
        expect(s).toContain("1uF");
        expect(s).toContain("6 parts in 3 values");
        expect(s).toContain("1 on bottom");
        await shot(page, "04-selected");

        await zoomAt(page, "C9", 6);
        await shot(page, "05-zoomed");

        // Strict matching: only the three 1uF parts.
        await page.click("button[aria-label=Settings]");
        await page.locator("dialog.settings").waitFor();
        await shot(page, "06-settings");
        await page.click("input[name=looseRatings]");
        await page.click("dialog.settings button.primary");
        s = await summary(page);
        expect(s).toContain("3 parts");
        expect(s).not.toContain("values");

        // Search by value: 100n also finds the part written 0.1uF.
        await page.click("button[aria-label='Clear selection']");
        await page.fill(".search-input", "100n");
        await page.waitForTimeout(100);
        expect(await summary(page)).toContain("8 matches");
        expect(await page.locator(".groups .ref.hit", { hasText: /^C5$/ }).count()).toBe(1);
        await shot(page, "07-search");
        await page.fill(".search-input", "");

        // Turn the board over.
        await page.click(".side-btn");
        await page.waitForTimeout(100);
        expect(await page.locator(".side-btn").innerText()).toContain("Bottom");
        await shot(page, "08-bottom");
        await page.click(".side-btn");

        // Drag the list up from its handle.
        const sheet = page.locator(".sheet");
        const before = (await sheet.boundingBox())!.height;
        const head = (await page.locator(".sheet-head").boundingBox())!;
        await page.mouse.move(head.x + head.width / 2, head.y + 8);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(head.x + head.width / 2, head.y + 8 - i * 20);
        await page.mouse.up();
        const after = (await sheet.boundingBox())!.height;
        expect(after).toBeGreaterThan(before + 150);
        await shot(page, "09-sheet-tall");

        // Tap the header: the list collapses to its header, tap again to open.
        await page.mouse.click(head.x + head.width / 2, head.y + 8 - 200);
        await page.waitForTimeout(50);
        expect((await sheet.boundingBox())!.height).toBeLessThan(120);
        await shot(page, "10-collapsed");
        await page.locator(".sheet-toggle").click();
        expect((await sheet.boundingBox())!.height).toBeGreaterThan(300);

        // Mark placed: one reference chip, then a whole group.
        await page.locator(".group", { hasText: "4k7" }).click();
        expect(await summary(page)).toContain("2 parts");
        await page.locator(".ref-chip", { hasText: "R9" }).click();
        expect(await page.locator(".ref-chip.on").count()).toBe(1);
        await page.locator(".group", { hasText: "27R" }).locator("input.placed-check").check();
        await page.click("button[aria-label='Clear selection']");
        expect(await summary(page)).toContain("3 placed");
        await shot(page, "11-placed");

        // Placed marks survive a reload.
        await page.reload();
        await boardReady(page);
        expect(await summary(page)).toContain("3 placed");

        // Back to the listing, then the KiCad 5 board.
        await page.goBack();
        await page.locator(".listing .files .file").first().waitFor();
        await page.locator(".file", { hasText: "legacy" }).click();
        await boardReady(page);
        await shot(page, "12-legacy");

        expect(errors).toEqual([]);
        await ctx.close();
    }, 90_000);

    test("dark theme and a desktop window", async () => {
        const errors: string[] = [];
        const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" }, errors);
        await page.goto(`${base}?gh=demo/boards&ref=HEAD&path=sample/sample.kicad_pcb`);
        await boardReady(page);
        await shot(page, "13-desktop-dark");
        await zoomAt(page, "U1", 5);
        await tapPart(page, "C6", false);
        const s = await summary(page);
        expect(s).toContain("100nF Capacitor");
        expect(s).toContain("8 parts");
        expect(s).toContain("C6");
        await shot(page, "14-desktop-zoomed");
        expect(errors).toEqual([]);
        await ctx.close();
    }, 60_000);
});
