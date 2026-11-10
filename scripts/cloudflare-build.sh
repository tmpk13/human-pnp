#!/usr/bin/env bash
# Build step for Cloudflare (wrangler.jsonc runs it before deploying).
#
# Cloudflare's build machines share IP addresses, so GitHub's limit of 60
# unauthenticated API calls an hour per address is usually used up there,
# and `mise install` looks up bun's versions through that API. So this reads
# the bun version pinned in mise.toml, gets that bun from npm (the build
# image has npm), and runs the same build as `mise run build`.
set -euo pipefail
want=$(sed -n 's/^bun = "\([^"]*\)"$/\1/p' mise.toml)
[ -n "$want" ] || { echo "cloudflare-build: no bun version in mise.toml" >&2; exit 1; }
if [ "$(bun --version 2>/dev/null || true)" != "$want" ]; then
    command -v npm >/dev/null 2>&1 || {
        echo "cloudflare-build: needs bun $want or npm on PATH (locally: mise run build)" >&2
        exit 1
    }
    echo "cloudflare-build: installing bun $want from npm"
    prefix="${XDG_CACHE_HOME:-$HOME/.cache}/human-pnp-bun"
    npm install --prefix "$prefix" --no-audit --no-fund --loglevel=error "bun@$want"
    export PATH="$prefix/node_modules/.bin:$PATH"
fi
echo "cloudflare-build: bun $(bun --version)"
bun install --silent
bun run build
