#!/usr/bin/env bash
set -euo pipefail
"$(npm root)"/.bin/terser app.js -o app.min.js -c -m -d __DEV__=false
