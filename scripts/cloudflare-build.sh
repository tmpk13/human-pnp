#!/usr/bin/env bash
# Build step for Cloudflare (wrangler.jsonc runs it before deploying): get
# mise if the build machine lacks it, install the tools pinned in mise.toml,
# then build the site into dist/.
set -euo pipefail
export MISE_YES=1
if ! command -v mise >/dev/null 2>&1; then
    curl -fsSL https://mise.run | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
mise trust
mise install
mise run build
