#!/usr/bin/env bash
# Prints "yes" when today's post for a workflow already went out, else "no".
# Usage: bash scripts/already-posted.sh <workflow file> <posted-marker artifact name>
# Checks the marker artifact, and also whether an earlier run of the workflow today reached its
# "Remember that today's ... went out" step, which only runs after a real post. The second check keeps
# backup runs from posting again when GitHub won't store new artifacts (storage quota full, 2026-10-14).
# Any API error fails the step, so a backup run that can't check never posts.
set -euo pipefail
workflow=$1 marker=$2
repo=$GITHUB_REPOSITORY
day=$(date -u +%F)
n=$(gh api "repos/$repo/actions/artifacts?name=$marker" --jq '.total_count')
if [ "$n" -gt 0 ]; then echo yes; exit 0; fi
runs=$(gh api "repos/$repo/actions/workflows/$workflow/runs?created=%3E%3D${day}T00:00:00Z&per_page=50" \
  --jq ".workflow_runs[] | select(.id != ${GITHUB_RUN_ID} and .event != \"pull_request\") | .id")
for id in $runs; do
  done_steps=$(gh api "repos/$repo/actions/runs/$id/jobs" \
    --jq '[.jobs[].steps[]? | select((.name | startswith("Remember that today")) and .conclusion == "success")] | length')
  if [ "$done_steps" -gt 0 ]; then echo yes; exit 0; fi
done
echo no
