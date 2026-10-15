#!/usr/bin/env bash
# Installs Playwright's Chromium (and ffmpeg with --ffmpeg) on a GitHub Actions runner for the posting workflows.
# Ubuntu's package mirrors are the weak spot: on 2026-10-01 one stalled for 30 minutes (the teaser timed out without
# posting), and on another run it crawled, so a timed-out apt-get kept holding the package lock and every retry failed
# at once. So this script:
#  - downloads Chromium from Playwright's CDN and only touches apt for system libraries if Chromium won't start,
#  - makes apt wait for the package lock instead of failing, and give up on a dead mirror after 30 seconds,
#  - gets ffmpeg as a static build from npm, with apt only as the fallback.
#   bash scripts/ci-install.sh [--ffmpeg]
set -uo pipefail

printf 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "3";\nDPkg::Lock::Timeout "600";\n' \
  | sudo tee /etc/apt/apt.conf.d/99-ci-timeouts >/dev/null

# try SECONDS COMMAND... runs COMMAND with a time limit, up to $TRIES times (default 3).
try() {
  local secs=$1 tries=${TRIES:-3}; shift
  for ((n = 1; n <= tries; n++)); do
    timeout -k 15 "$secs" "$@" && return 0
    echo "::warning::'$*' failed or stalled (try $n of $tries)"
    [ "$n" -lt "$tries" ] && sleep $((n * 10))
  done
  return 1
}
launch() { node -e "require('playwright').chromium.launch().then(b => b.close())"; }

try 180 npm i --no-save playwright@1.56.1 || { echo "::error::Couldn't install Playwright"; exit 1; }
try 300 npx playwright install chromium || { echo "::error::Couldn't download Chromium"; exit 1; }
if ! launch; then
  echo "Chromium is missing system libraries; installing them."
  TRIES=2 try 600 npx playwright install-deps chromium
  launch || { echo "::error::Chromium still won't start"; exit 1; }
fi

if [ "${1:-}" = "--ffmpeg" ] && ! command -v ffmpeg >/dev/null; then
  # Both in one install: npm removes unsaved packages it is not told about.
  if try 180 npm i --no-save playwright@1.56.1 ffmpeg-static@5.2.0; then
    dir=$(node -p "require('path').dirname(require('ffmpeg-static'))")
    echo "$dir" >> "${GITHUB_PATH:-/dev/null}"
    export PATH="$dir:$PATH"
  else
    echo "::warning::The static ffmpeg build didn't install; trying apt instead."
    TRIES=1 try 240 sudo apt-get update -qq && TRIES=1 try 420 sudo apt-get install -y -qq --no-install-recommends ffmpeg
  fi
  ffmpeg -version | head -1 || { echo "::error::ffmpeg won't run"; exit 1; }
fi
