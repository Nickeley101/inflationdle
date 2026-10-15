# Tests

Automated checks for inflationdle.com. GitHub Actions runs them on every pull request and every push to main
(`.github/workflows/tests.yml`), and checks the live site daily and after each deploy (`live-site.yml`).

| Suite | What it covers | Where |
| --- | --- | --- |
| Unit | Visitor counter API (counting, privacy, caching, bad input, outages); price pages hiding a live round's item; which files the site publishes; `_headers` security headers; no inline scripts, secrets or unsafe links; schedule rules and price data for every country | `unit/` (Node's built-in test runner) |
| Browser | Daily and practice rounds, winning, losing, bad bids, reloads, streaks, share text, clipboard, country dailies and picker, keyboard play, chart | `e2e/daily.spec.mjs`, `e2e/modes.spec.mjs` |
| Accessibility and usability | axe-core WCAG 2.2 AA scans of every page and game state, tap target sizes, small phones, reduced motion, screen-reader announcements | `e2e/usability.spec.mjs` |
| Security (browser) | Security headers, no CSP violations on any page, private files 404, live item hidden, answer never stored | `e2e/security.spec.mjs` |
| Live site | The same header, private-file, API and spoiler checks against the real site (read-only) | `live/` |
| Secrets and dependencies | gitleaks over the whole git history, `npm audit`, weekly Dependabot updates | `tests.yml`, `.github/dependabot.yml` |

Browser tests run in Chromium at desktop and phone (Pixel 7) sizes, and on CI also in WebKit (iPhone 14) and Firefox.
Every browser test also fails on any console error or Content-Security-Policy violation.

## Running them

```sh
cd tests
npm install                                   # once
npx playwright install chromium               # once
npm run test:unit                             # fast, no browser
npm run test:e2e                              # starts tests/server.mjs and runs the browser tests
npm run test:live                             # checks https://inflationdle.com (SITE=... for another address)
npm run serve                                 # the local copy of the site on http://localhost:4173
```

`tests/server.mjs` runs the real `worker/index.js` in front of the repo's files, with `_headers`, `.assetsignore` and an
in-memory visitor counter (Node's built-in SQLite in place of D1), so the tests exercise the same code as production.

## Known issues

A few tests are marked `todo` (unit) or listed in `KNOWN` / `KNOWN_SMALL` (`e2e/usability.spec.mjs`). Each names a
problem found when the suite was written. They report but don't fail the build; once the problem is fixed, remove the
marker so it can't come back.
