#!/usr/bin/env bash
# SilentCatch retrospective audit — the scheduled-batch half of the deployment.
#
# Intended as the command of a Nebius Serverless Job (run-to-completion,
# one VM, billed while running). It runs in the SAME container image as the
# real-time Endpoint; only the command differs:
#   Endpoint (sync pre-discharge interlock):  uvicorn backend.main:app
#   Job (nightly retrospective):              jobs/retrospective.sh --live
#
# What it does: re-audits discharge records through the tiered router
# (Nano gate -> Tavily evidence -> Ultra reasoning -> span-guard rig) and
# writes a scored JSON artifact. Default is replay mode (no provider calls,
# no keys needed). Pass --live for real Token Factory inference.
#
# Scale: the harness audits cases sequentially within one job. Shard across
# N scheduled jobs with repeatable --case flags (Serverless AI is one VM
# per job, so parallelism comes from sharding, not threads).
#
# Run from any directory. Auto-detects local .venv or container python.
# PYTHON env override supported:
#   PYTHON=./.venv/bin/python jobs/retrospective.sh --limit 2
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MODE="--replay"
CASES=()
LIMIT=""
OUTPUT="${RETROSPECTIVE_OUTPUT:-eval/results_retrospective.json}"

if [[ -z "${PYTHON:-}" ]]; then
  if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    PYTHON="$REPO_ROOT/.venv/bin/python"
  else
    PYTHON="python"
  fi
fi

usage() {
  cat <<EOF
Usage: jobs/retrospective.sh [--live] [--case ED-101 ...] [--limit N] [--output PATH]

  --live        Real Token Factory inference (requires NEBIUS_API_KEY). Default: replay.
  --case ID     Audit one encounter (repeatable; this is the sharding key).
  --limit N     Audit only the first N encounters.
  --output PATH Artifact path (default: eval/results_retrospective.json).
  -h, --help    Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --live) MODE="--live"; shift ;;
    --case)
      [[ $# -lt 2 ]] && { echo "ERROR: --case needs an encounter id." >&2; exit 2; }
      CASES+=(--case "$2"); shift 2 ;;
    --limit)
      [[ $# -lt 2 ]] && { echo "ERROR: --limit needs a number." >&2; exit 2; }
      LIMIT="$2"; shift 2 ;;
    --output)
      [[ $# -lt 2 ]] && { echo "ERROR: --output needs a path." >&2; exit 2; }
      OUTPUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$MODE" == "--live" && -z "${NEBIUS_API_KEY:-}" ]]; then
  echo "ERROR: --live requires NEBIUS_API_KEY (the harness refuses to fabricate live results)." >&2
  exit 2
fi

ARGS=("$MODE" --config tiered --output "$OUTPUT" --json)
[[ ${#CASES[@]} -gt 0 ]] && ARGS+=("${CASES[@]}")
[[ -n "$LIMIT" ]] && ARGS+=(--limit "$LIMIT")

exec "$PYTHON" eval/benchmark.py "${ARGS[@]}"
