#!/usr/bin/env bash
# このスキルの雛形（見本の動画つき）を video/ に置く
set -eu
node "$(dirname "$0")/../../scripts/new.mjs" video
