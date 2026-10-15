# Inflationdle

A daily price-guessing game. Each day shows one item (groceries, energy, electronics), a market, and a date. Players get six guesses to land within 5% of the real price, then share an emoji grid.

## Run locally

It is a static site with no build step. Serve the folder with any static server:

```sh
npx serve .
# or
python3 -m http.server 8000
```

Opening `index.html` directly from disk will not work, because the game loads `data/prices.json` with `fetch`.

## Data

`data/prices.json` holds every series.

- **Groceries and Energy:** BLS Average Price Data, January value of each year. `id` is the BLS series id (also on FRED, e.g. https://fred.stlouisfed.org/series/APU0000708111). `start` is the first year, `v` the yearly values, `null` where BLS published nothing. Optional `latest` (`{period: "YYYY-MM", value}`) is the newest monthly value; the results screen shows it as the current price, labeled with its month, so it matches what BLS and FRED display. Without it, the newest January is used and labeled as such.
- **Electronics:** U.S. launch or list MSRP, one product line per series (PlayStation, Nintendo home and handheld, Xbox, Sega, iPhone, iPad, iPod). `pts` rows are `[year, price, product, month, source URL]`; `src` says where the line's prices come from (default: each console's Wikipedia article). The newest row is the "latest launch"; the earlier rows are rounds.

Refresh the BLS series, and add the metro and regional ones listed in `data/metros.json`:

```sh
node scripts/update-prices.mjs                    # reads FRED's copy of each BLS series, no key needed
BLS_API_KEY=your_key node scripts/update-prices.mjs   # reads the BLS API directly
```

After any change to `data/prices.json`, re-plan the daily puzzles with `node scripts/schedule.mjs`. It writes `data/schedule.json`, one round per day, and never changes a day that is already live or teased on X. Pull requests that touch the data fail their check until the schedule is re-planned. To hand-pick a round for a future day, add it to `data/picks.json` (`{"9": "AAPL:2007"}`, day number to `SYM:year`) and re-plan.

FRED republishes BLS Average Price data unchanged under the same series ids. Keyless BLS API access is capped at 25 requests a day per IP and is often used up, so FRED is the default. A free BLS key is at https://data.bls.gov/registrationEngine/. BLS releases each month's prices about two weeks after the month ends, so run the refresh mid-month.

BLS publishes food prices for the U.S. and four regions only; gas and electricity also come by metro area. Metro electricity on FRED currently stops at late 2024, so those series show that month as their latest price.

## Deploy

Built for Cloudflare Pages: connect this repo, leave the build command empty, and set the output directory to `/`. `_headers` sets the security headers (CSP, HSTS).

## Daily X post

`.github/workflows/daily-x-post.yml` runs every day at 13:00 UTC. It builds a card with yesterday's answer (`scripts/daily-card.mjs`) and posts it to X with a teaser for today's puzzle (`scripts/post-to-x.mjs`). Each run keeps the card as a downloadable artifact.

It only posts once these four repository secrets exist (Settings > Secrets and variables > Actions): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`. Get them from an app in the X developer portal with Read and Write permission. Without them, every run is a dry run. To test, open Actions > Daily X post > Run workflow; it builds the card without posting unless you untick "dry run".

`scripts/daily-card.mjs` copies the daily pick logic from `src/game.js`. If that logic changes, update both.

Posts carry no link (X charges much more per post with one); the card image shows the site. Try it locally: `npm i --no-save playwright && npx playwright install chromium && node scripts/daily-card.mjs --day 5`.

## Game rules

- Six guesses. Within 5% wins (green), within 25% is close (amber), otherwise a miss (red).
- Daily puzzle #1 is 2026-09-25. Puzzles come from a seeded shuffle of every round, so everyone gets the same item each day. Every 4th day is an Energy (gas or electricity) round; the other days draw from the rest.
- Stats and streaks are stored in the player's browser. There are no accounts.
