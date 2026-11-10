// Serve a built site the way GitHub Pages does for a project page: under
// /human-pnp/, on every network interface so a phone on the same network
// can open it.
//
// Usage: bun run scripts/serve.ts <dir> <port>

import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";

const dir = process.argv[2] ?? "dist";
const port = Number(process.argv[3] ?? 3001);
const prefix = "/human-pnp/";
const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".map": "application/json",
};

Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        if (path === "/" || path === "/human-pnp") return Response.redirect(prefix, 302);
        if (!path.startsWith(prefix)) return new Response("Not found", { status: 404 });
        const rel = normalize(path.slice(prefix.length) || "index.html");
        if (rel.startsWith("..")) return new Response("Not found", { status: 404 });
        const file = Bun.file(join(dir, rel));
        if (!(await file.exists())) return new Response("Not found", { status: 404 });
        return new Response(file, { headers: { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" } });
    },
});

const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
for (const host of ["localhost", ...addresses]) console.log(`http://${host}:${port}${prefix}`);
