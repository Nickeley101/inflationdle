// Renders yesterday's round as a 9:16 "guess the price" video (promo/guess.html) for Shorts, Reels, TikTok and Bluesky.
//   node scripts/daily-video.mjs            # the newest round that has ended in every time zone
//   node scripts/daily-video.mjs --day 5    # the video that would go out on puzzle day 5 (round 4)
//   node scripts/daily-video.mjs --round EGGS:1990   # a one-off video of any round that isn't a coming daily puzzle
//   node scripts/daily-video.mjs --teaser   # today's puzzle with no reveal (promo/teaser.html); with --day N, day N's
//   node scripts/daily-video.mjs --evening  # evening post (promo/evening.html): six U.S. prices in one year vs today, picked
//                                           # by the date from rounds that aren't live or still to come; --day N picks as on day N
//   node scripts/daily-video.mjs --spotlight  # midday post (promo/spotlight.html): one item, every year's price racing to
//                                             # today, picked by scripts/spotlight-picks.mjs.
// TITLE and DESCRIPTION env vars replace the generated title and caption.
// Writes out/video.mp4, out/video-cover.png and out/video.json (title, caption, alt text).
// Needs Playwright with Chromium and ffmpeg.
import {readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, createReadStream} from "node:fs";
import {spawnSync, spawn} from "node:child_process";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {soundtrack, teaserSoundtrack, eveningSoundtrack, spotlightSoundtrack} from "./video-audio.mjs";
import {spotlightPick} from "./spotlight-picks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out"), promo = path.join(root, "promo");
mkdirSync(out, {recursive: true});

const EPOCH = Date.UTC(2026, 8, 25);
// Players get puzzle N on their local date, so it's live until that date ends in the last time zone (UTC-12),
// which is 12:00 UTC the next day. Only a round that has ended everywhere can be revealed. Counting from the
// clock rather than "yesterday in UTC" keeps a late-starting scheduled run (GitHub can delay cron by hours)
// from revealing a round that's still being played in the Americas.
const argDay = process.argv.indexOf("--day");
const ENDED = argDay > 0 ? Number(process.argv[argDay + 1]) - 1 : Math.floor((Date.now() - EPOCH - 12 * 36e5) / 864e5);
if (!Number.isInteger(ENDED)) { console.error("Bad --day value."); process.exit(1); }
const argRound = process.argv.indexOf("--round"), ROUND = argRound > 0 ? process.argv[argRound + 1] : null;
const TEASER = process.argv.includes("--teaser"), EVENING = process.argv.includes("--evening"), SPOTLIGHT = process.argv.includes("--spotlight");
const {days} = JSON.parse(readFileSync(path.join(root, "data/schedule.json"), "utf8"));
const {series} = JSON.parse(readFileSync(path.join(root, "data/prices.json"), "utf8"));
let Y = null, key, meta, page, query;
// Mirrors fmt() in src/game.js.
const fmtUSD = p => "$" + (p < 1 ? p.toFixed(3).replace(/0$/, "") : p.toLocaleString("en-US", {minimumFractionDigits: p >= 1000 ? 0 : 2, maximumFractionDigits: p >= 1000 ? 0 : 2}));
if (EVENING) {
  // Every round that hasn't ended everywhere stays out: its item and year together would give the price away.
  // The items of the live rounds stay out entirely, so the video doesn't hint at today's answer either.
  const hidden = new Set(days.slice(Math.max(0, ENDED)));
  const live = new Set(days.slice(Math.max(0, ENDED), ENDED + 2).map(k => k.split(":")[0].split(".")[0]));
  const thisYear = new Date().getUTCFullYear();
  // Current U.S. averages only: a retired item's "today" would be years old. Series with product names (pts) change product over time.
  const pool = series.filter(x => /^U\.S\. City/.test(x.loc) && !x.pts && x.latest && +x.latest.period.slice(0, 4) >= thisYear - 1 && !live.has(x.sym));
  // Repeatable per day: the same day always gets the same video.
  let seed = (ENDED + 1) * 2654435761 >>> 0;
  const rand = n => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
  let year, items = [];
  for (let tries = 0; tries < 40 && items.length < 6; tries++) {
    year = 1980 + rand(31);  // 1980 to 2010
    const ok = pool.filter(x => x.v[year - x.start] != null && !hidden.has(`${x.sym}:${year}`)).map(x => x.sym);
    items = [];
    while (ok.length && items.length < 6) items.push(ok.splice(rand(ok.length), 1)[0]);
  }
  if (items.length < 6) { console.error("Couldn't find six prices for the evening video."); process.exit(1); }
  const question = `${year} vs today: which price jumped the most?`;
  meta = {day: null, kind: "evening", teaser: false, year, items, question,
    title: process.env.TITLE || `${year} prices vs today: which one jumped the most? #shorts`,
    caption: process.env.DESCRIPTION || [
      `${question} Comment your pick before the numbers move.`,
      ``,
      `Inflationdle: a new price to guess every day. Link in bio.`,
      `Prices: BLS U.S. averages via FRED. Inflation: CPI-U.`,
      ``,
      `#inflation #prices #thenvsnow #dailygame #inflationdle`,
    ].join("\n"),
    alt: `Video comparing six U.S. average prices in ${year} with today's: ${items.map(k => series.find(x => x.sym === k).name.split(",")[0].toLowerCase()).join(", ")}. The prices tick up to today and the biggest jump is highlighted.`,
    bsky: [question, `Comment your pick before the numbers move.`, ``, `Link in bio`]};
  page = "evening"; query = `year=${year}&items=${items.join(",")}`;
} else if (SPOTLIGHT) {
  // One item a day from scripts/spotlight-picks.mjs (favorites every third day, every other long U.S. price history in
  // between, each with a hook that asks for a personal year). Every price shown is a real published one; the items of
  // the live rounds stay out so the chart can't give today's answer away.
  const {sym, name, place, hook, cta, src, when} = spotlightPick(series, days, ENDED + 1), s = series.find(x => x.sym === sym);
  if (!s) { console.error(`No series ${sym}.`); process.exit(1); }
  const rows = s.pts ? s.pts.filter(p => p[0] >= 1975) : null;
  const first = Math.max(1975, rows ? rows[0][0] : s.start);
  const now = rows ? rows.at(-1)[1] : s.latest.value, then = rows ? rows[0][1] : s.v[first - s.start];
  if (!(now > 0 && then > 0)) { console.error(`No prices for ${sym}.`); process.exit(1); }
  const lower = name.toLowerCase(), where = place ? " " + place : "";
  // Points on the chart, as promo/spotlight.html counts them (BLS: each January plus the latest month), for the soundtrack's blips.
  const years = rows ? rows.length : s.v.slice(first - s.start).filter(v => v != null).length + 1;
  meta = {day: null, kind: "spotlight", teaser: false, sym, years, question: hook,
    title: process.env.TITLE || `${name} prices${where} every year since ${first}. Find ${when} #shorts`,
    caption: process.env.DESCRIPTION || [
      `${hook} Pause on your year, then ${cta.toLowerCase()} and what you remember paying.`,
      ``,
      `Inflationdle: a new price to guess every day. Link in bio.`,
      src ? `Prices: ${src}. Inflation: CPI-U.` : `Prices: BLS ${place ? "" : "U.S. "}averages via FRED (January each year). Inflation: CPI-U.`,
      ``,
      `#inflation #prices #thenvsnow #${lower.replace(/[^a-z0-9]/g, "")} #inflationdle`,
    ].join("\n"),
    alt: `Video of the price of ${lower}${where || " in the U.S."} every year from ${first} to today, a line chart drawing as the years count up, then how much it rose compared with inflation.`,
    bsky: [hook, `Pause on your year, then ${cta.toLowerCase()}.`, ``, `Link in bio`],
    x: [hook, ``, `${name}${where}, ${s.unit}: ${fmtUSD(then)} in ${first}, ${fmtUSD(now)} today.`, ``, `${cta.replace(/^Comment/, "Reply with")} and what you remember paying.`]};
  page = "spotlight"; query = new URLSearchParams({sym, name, hook, cta, ...(src ? {src} : {})}).toString();
} else if (TEASER) {
  // Today's live puzzle. teaser.html never shows its price, so this is the one mode that may use a live round.
  Y = argDay > 0 ? ENDED + 1 : Math.floor((Date.now() - EPOCH) / 864e5) + 1;
  if (!days[Y - 1]) { console.error(`data/schedule.json has no round for day ${Y}.`); process.exit(1); }
  key = days[Y - 1];
} else if (ROUND) {
  // A one-off round must not be a daily puzzle that's still live anywhere or still to come, or the video would give that answer away.
  const d = days.indexOf(ROUND) + 1;
  if (d > ENDED) { console.error(`${ROUND} is the daily puzzle on day ${d}; pick another round.`); process.exit(1); }
  key = ROUND;
} else {
  // Never show a round someone can still play: the video gives the answer away.
  if (ENDED < 1) { console.log("No round has ended in every time zone yet; no video."); process.exit(0); }
  Y = ENDED;
  if (!days[Y - 1]) { console.error(`data/schedule.json has no round for day ${Y}.`); process.exit(1); }
  key = days[Y - 1];
}

const SECONDS = SPOTLIGHT ? 10 : 15;

if (!EVENING && !SPOTLIGHT) {
// Caption text, from the same data the video draws.
const [sym, yearStr] = key.split(":"), year = Number(yearStr);
const s = series.find(x => x.sym === sym);
if (!s || !(s.pts ? s.pts.some(p => p[0] === year) : s.v[year - s.start] != null)) { console.error(`No price for ${key}.`); process.exit(1); }
const pt = s.pts ? s.pts.find(p => p[0] === year) : null;
const NAMES = {HOUSE: "a new house", STAMP: "a first-class stamp", SUBWAY: "a New York subway ride", EGGS: "a dozen eggs", GAS: "a gallon of gas", POWER: "electricity", MCD: "a Big Mac"};
// Mirrors ITEM in promo/guess.html.
const an = n => (/^[AEIOU]|^(iP|X)/i.test(n) && !/^U[a-z]/.test(n) ? "an " : "a ") + n;
const item = pt?.[2] ? an(pt[2]) : NAMES[sym.split(".")[0]] || (s.cat === "Subscriptions" ? s.name : s.name.split(",")[0].toLowerCase());
// "in the U.S." for national prices, else the region or metro, e.g. "in the Midwest", "in the Boston area", "in urban Hawaii".
const where = /^U\.S\./.test(s.loc) ? "in the U.S." : / City$/.test(s.loc) ? "in " + s.loc : /^Urban /.test(s.loc) ? "in urban " + s.loc.slice(6)
  : "in the " + s.loc.replace(" (urban)", "");
const question = `What did ${item} cost ${where} in ${year}?`;
const title = process.env.TITLE || (TEASER ? `${question} Today's puzzle #shorts` : `${question} #shorts`);
// No "#" before the game number: TikTok counts "#12" toward its five-hashtag limit.
const caption = process.env.DESCRIPTION || (TEASER ? [
  `Today's puzzle: ${question} Comment your guess. The answer comes tomorrow.`,
  ``,
  `Inflationdle No. ${Y}: a new price to guess every day. Link in bio.`,
  `Prices from real published data, inflation from CPI-U.`,
  ``,
  `#inflation #prices #guesstheprice #dailygame #inflationdle`,
] : [
  `${question} Comment your guess before the reveal.`,
  ``,
  Y ? `Inflationdle No. ${Y}: a new price to guess every day. Link in bio.` : `Inflationdle: a new price to guess every day. Link in bio.`,
  `Prices from real published data, inflation from CPI-U.`,
  ``,
  `#inflation #prices #guesstheprice #dailygame #inflationdle`,
]).join("\n");
const alt = TEASER ? `Teaser video for today's Inflationdle puzzle. ${question} The price isn't shown; it asks you to comment your guess.`
  : `Guess-the-price video. ${question} It shows two wrong guesses and a countdown, then reveals the real price and a chart of the price since then, and ends on the next puzzle's question.`;
meta = {day: Y, teaser: TEASER, sym, year, question, title, caption, alt};
page = TEASER ? "teaser" : "guess"; query = Y ? `day=${Y}` : `sym=${encodeURIComponent(sym)}&year=${year}`;
}
writeFileSync(path.join(out, "video.json"), JSON.stringify(meta, null, 2));

// Data for the templates, then serve promo/ on a local port for the renderer.
spawnSync(process.execPath, [path.join(root, "scripts/promo-data.mjs")], {stdio: "inherit"});
const TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml"};
const server = createServer((req, res) => {
  const f = path.join(promo, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(promo) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {"Content-Type": TYPES[path.extname(f)] || "application/octet-stream"});
  createReadStream(f).pipe(res);
}).listen(0);
await new Promise(r => server.once("listening", r));
const port = server.address().port;

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, {stdio: "inherit", ...opts});
  p.on("exit", code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)));
});
const frames = path.join(out, "frames");
try {
  await run(process.execPath, [path.join(promo, "render.mjs"), page, String(SECONDS), "30", "1080", "1920", query, frames],
    {cwd: promo, env: {...process.env, PORT: String(port)}});
} finally { server.close(); }

// Soundtrack synthesized in scripts/video-audio.mjs, timed to the template's scenes.
writeFileSync(path.join(out, "audio.wav"), EVENING ? eveningSoundtrack(SECONDS) : SPOTLIGHT ? spotlightSoundtrack(SECONDS, meta.years) : TEASER ? teaserSoundtrack(SECONDS) : soundtrack(SECONDS));
await run("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", path.join(frames, "f%04d.png"),
  "-i", path.join(out, "audio.wav"), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", path.join(out, "video.mp4")]);
// Cover: the frame with the question on screen (1 second in), before any answer shows.
await run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(frames, "f0030.png"), path.join(out, "video-cover.png")]);
// X can't take the video yet (no chunked upload in post-to-x.mjs), so it gets the frame with the full chart and the change.
if (SPOTLIGHT) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(frames, "f0195.png"), path.join(out, "card.png")]);
  writeFileSync(path.join(out, "post.txt"), meta.x.join("\n"));
}
rmSync(frames, {recursive: true, force: true});
console.log(`${EVENING ? "Evening video" : SPOTLIGHT ? "Spotlight video" : TEASER ? "Teaser" : "Video"} (${query}) → out/video.mp4\n\n${meta.title}\n\n${meta.caption}`);
