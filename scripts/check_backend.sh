#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
uv run --locked ruff check app tests
uv run --locked ruff format --check app tests
uv run --locked mypy
uv run --locked pytest "$@"
bash -n scripts/deploy_vps.sh scripts/update_vps.sh scripts/check_backend.sh
