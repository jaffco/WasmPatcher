#!/usr/bin/env bash
# Serve the WasmPatcher static site
# Requires Python 3 (ships with macOS)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$SCRIPT_DIR/site"
PORT="${1:-8080}"

echo "▶ Serving WasmPatcher at http://localhost:$PORT"
echo "  Press Ctrl-C to stop."
cd "$SITE_DIR" && python3 -m http.server "$PORT" --bind 127.0.0.1
