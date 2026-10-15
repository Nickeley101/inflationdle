# Promo video templates

HTML pages that draw short videos and images from the game's data. Each video page exposes `render(t)`, which
draws the frame at `t` seconds, so `render.mjs` can screenshot every frame headlessly and ffmpeg can join them.

| Page | Size | Length | What it shows |
|---|---|---|---|
| `guess.html?day=N` or `guess.html?sym=EGGS&year=1992` | 1080x1920 | 15s | "What did X cost in YEAR?" from the first frame, two wrong guesses, a 3-2-1 "comment your guess", the price ticking up to the answer, the chart to today, then (with `day=N`) the next puzzle's question so a replay loops. `day=N` uses round N of `data/schedule.json`, so only use it for days already played (it shows the answer). |
| `teaser.html?day=N` | 1080x1920 | 15s | Today's puzzle with no reveal: the question, a hidden `$ ? ? ?` price, six empty guesses, "Comment your guess", an end card, and the question again so a replay loops. Safe for a live round. |
| `evening.html?year=1994&items=EGGS,BREAD,...` | 1080x1920 | 15s | Six U.S. prices in one year vs today: "Which one jumped the most?", a 3-2-1 "comment your pick", the prices ticking up, the biggest jump, an end card, and the opening frame again. `node scripts/daily-video.mjs --evening` picks the year and items, leaving out live and coming rounds. |
| `spotlight.html?sym=BEER&name=Beer&hook=...&cta=...` | 1080x1920 | 10s | One item people care about: the item and a "the year you turned 21" style hook from the first frame, every year's price racing to today while the chart rescales, red chips on big one-year jumps, the total change slamming in against inflation, an end card with inflationdle.com, then the opening frame again. `node scripts/daily-video.mjs --spotlight` makes the 16:00 UTC post; `node scripts/spotlight-picks.mjs 30` lists the coming picks. |
| `gas-race.html?fmt=v` / `?fmt=s` | 1080x1920 / 1080x1080 | 14s | U.S. gas price racing from 1980 to the latest month, then gas vs. CPI. |
| `then-now.html?fmt=v` / `?fmt=s` | 1080x1920 / 1080x1080 | 10s | Six U.S. prices counting up from 1980 to today, red if they beat CPI. |
| `header.html` / `youtube-banner.html` | 1500x500 (scale 2 for 3000x1000) / 2560x1440 | still | X header, Bluesky banner and YouTube channel art. The "Render banners" workflow renders all three with the real fonts into `banners/` when a PR changes them. |

All numbers come from `series.js`, which `node scripts/promo-data.mjs` writes from `data/`. Rerun it after the price data changes.

```sh
node scripts/promo-data.mjs
cd promo
npm i --no-save playwright http-server && npx playwright install --with-deps chromium
npx http-server -p 8124 -s . &
node render.mjs guess 15 30 1080 1920 "day=3" frames
ffmpeg -y -framerate 30 -i frames/f%04d.png -f lavfi -i anullsrc=r=44100:cl=stereo \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -c:a aac -shortest -movflags +faststart guess-day3.mp4
```

The videos are silent on purpose (a silent audio track keeps apps happy); add a trending sound in the app when posting.
