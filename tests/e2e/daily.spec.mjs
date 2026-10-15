// The daily round: loading, bidding, winning, losing, sharing, saving progress and stats.
import {test, expect, openGame, bid, stats, todayNY, addDays, noonNY} from "./fixtures.mjs";
import {winningBid, losingBids, roundFor, pricePages} from "../lib/game-data.mjs";

test("today's daily loads with its number, item and six bids", async ({page}) => {
  const r = await openGame(page);
  expect(r, "the schedule covers today").toBeTruthy();
  await expect(page.locator("#no")).toHaveText("#" + r.day);
  await expect(page.locator("#item")).toContainText((r.name || r.s.name).split(",")[0].split(" ")[0]);
  await expect(page.locator("#item .yr")).toContainText(String(r.y));
  await expect(page.locator("#lcount")).toHaveText("0 of 6");
  await expect(page.locator("#mDaily")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#result")).not.toBeVisible();
});

test("the answer is not on the page before the round ends", async ({page}) => {
  const r = await openGame(page);
  // Nothing in the results pop-up is filled in yet, and the board has no answer row.
  await expect(page.locator("#rActual")).toBeEmpty();
  await expect(page.locator("#shareText")).toBeEmpty();
  await expect(page.locator("#log li.ans")).toHaveCount(0);
  // The ticker leaves today's item off, since its first price can be the answer.
  const base = r.sym.split(".")[0];
  const tapeSyms = await page.locator("#tape .tape-item b").allTextContents();
  expect(tapeSyms.length).toBeGreaterThan(5);
  expect(tapeSyms.map(s => s.split(".")[0])).not.toContain(base);
  // After a few misses the page still hasn't shown it.
  for (const b of losingBids(r).slice(0, 3)) await bid(page, b);
  await expect(page.locator("#rActual")).toBeEmpty();
  await expect(page.locator("#log li.ans")).toHaveCount(0);
});

test("a first-bid win fills the order, updates stats and builds the share text", async ({page}) => {
  const r = await openGame(page);
  await bid(page, winningBid(r));
  const dlg = page.locator("#result");
  await expect(dlg).toBeVisible();
  await expect(page.locator("#verdict")).toHaveText("Order filled in 1/6");
  await expect(page.locator("#log li.hit")).toHaveCount(1);
  await expect(page.locator("#form")).toBeHidden();
  await expect(page.locator("#sPlayed")).toHaveText("1");
  await expect(page.locator("#sWin")).toHaveText("100%");
  await expect(page.locator("#sStreak")).toHaveText("1");
  await expect(page.locator("#dist li.me")).toHaveCount(1);
  await expect(page.locator("#chart path")).toHaveCount(2);
  const share = await page.locator("#shareText").textContent();
  const lines = share.split("\n");
  expect(lines[0]).toBe(`Inflationdle #${r.day} 1/6`);
  expect(lines[1]).toContain(String(r.y));
  expect(lines).toContain("🟩☑️");
  expect(lines.at(-1)).toBe("https://inflationdle.com");
  expect(share).not.toMatch(/\$\d/); // the share text never spoils the price
  expect(await stats(page)).toMatchObject({played: 1, wins: 1, streak: 1, best: 1, lastDay: r.day});
});

test("finishing the daily opens that item's price history early, on this browser only", async ({page, browser, issues}) => {
  issues.allow(/status of 503/);
  const r = await openGame(page);
  const pages = pricePages(), path = Object.keys(pages).find(p => pages[p] === r.key.split(":")[0].split(".")[0]);
  test.skip(!path, "today's item has no price page");
  expect((await page.request.get(path)).status(), "hidden before finishing").toBe(503);
  await bid(page, winningBid(r));
  await expect(page.locator("#result")).toBeVisible();
  expect((await page.context().cookies()).find(c => c.name === "ic_done")?.value).toBe(String(r.day));
  const res = await page.goto(path);
  expect(res.status()).toBe(200);
  await expect(page.locator("table")).not.toHaveCount(0);
  const other = await browser.newPage();
  expect((await other.request.get(path)).status(), "another browser still sees it hidden").toBe(503);
  await other.close();
});

test("a tagged profile link (?ref=tiktok) is counted once and dropped from the address bar", async ({page}) => {
  const hits = [];
  page.on("request", r => { if (r.url().includes("/api/ref")) hits.push(r.url()); });
  await openGame(page, {query: "ref=tiktok"});
  await expect.poll(() => hits.length).toBe(1);
  expect(hits[0]).toMatch(/\/api\/ref\?src=tiktok$/);
  expect(page.url()).not.toContain("ref=");
  await page.goto("/?ref=tiktok");
  await expect(page.locator("#item")).not.toBeEmpty();
  await page.waitForTimeout(300);
  expect(hits.length, "same browser, same day: not sent again").toBe(1);
});

test("six misses expire the order and reveal the answer", async ({page}) => {
  const r = await openGame(page);
  for (const b of losingBids(r)) await bid(page, b);
  await expect(page.locator("#verdict")).toHaveText("Order expired");
  await expect(page.locator("#log li.cold, #log li.warm")).toHaveCount(6);
  await expect(page.locator("#log li.ans")).toHaveCount(1);
  await expect(page.locator("#closest")).toBeVisible();
  await expect(page.locator("#closest")).toContainText("too high");
  await expect(page.locator("#sStreak")).toHaveText("0");
  const share = await page.locator("#shareText").textContent();
  expect(share.split("\n")[0]).toBe(`Inflationdle #${r.day} X/6`);
  expect(share.match(/🟥⬇️|🟨⬇️/g)).toHaveLength(6);
  expect(await stats(page)).toMatchObject({played: 1, wins: 0, streak: 0});
});

test("misses say higher or lower and narrow the range", async ({page}) => {
  const r = await openGame(page);
  const [hi] = losingBids(r);
  await bid(page, hi);
  await expect(page.locator("#log li").first()).toContainText("LOWER");
  await expect(page.locator("#range")).toContainText("It's below");
  await expect(page.locator("#lcount")).toHaveText("1 of 6");
  await expect(page.locator("#sr")).toContainText("Lower");
  const low = (r.p / 3).toFixed(2);
  if (Number(low) > 0 && Math.abs(Number(low) - r.p) > Math.max(.05 * r.p, .02)) {
    await bid(page, low);
    await expect(page.locator("#log li").nth(1)).toContainText("HIGHER");
    await expect(page.locator("#range")).toContainText("It's between");
  }
});

test("bad bids are refused without using up a guess", async ({page}) => {
  const r = await openGame(page);
  for (const bad of ["abc", "0", "-5", "", "100001"]) {
    await bid(page, bad);
    await expect(page.locator("#err"), `bid "${bad}"`).toBeVisible();
    await expect(page.locator("#lcount")).toHaveText("0 of 6");
  }
  const [b1] = losingBids(r);
  await bid(page, b1);
  await expect(page.locator("#err")).toBeHidden();
  await bid(page, b1);
  await expect(page.locator("#err")).toContainText("already bid");
  await bid(page, (Number(b1) + 5).toFixed(2));
  await expect(page.locator("#err")).toContainText("Bid lower");
  await expect(page.locator("#lcount")).toHaveText("1 of 6");
  await expect(page.locator("#guess")).toHaveAttribute("aria-invalid", "true");
  // Dollar signs and commas are fine.
  await bid(page, "$" + Number(losingBids(r)[1]).toLocaleString("en-US", {minimumFractionDigits: 2}));
  await expect(page.locator("#err")).toBeHidden();
  await expect(page.locator("#lcount")).toHaveText("2 of 6");
});

test("a reload mid-round keeps the bids", async ({page}) => {
  const r = await openGame(page);
  const bids = losingBids(r).slice(0, 2);
  for (const b of bids) await bid(page, b);
  await page.reload();
  await expect(page.locator("#log li.cold, #log li.warm")).toHaveCount(2);
  await expect(page.locator("#lcount")).toHaveText("2 of 6");
  await bid(page, winningBid(r));
  await expect(page.locator("#verdict")).toHaveText("Order filled in 3/6");
});

test("a finished daily stays finished after a reload and isn't counted twice", async ({page}) => {
  const r = await openGame(page);
  await bid(page, winningBid(r));
  await expect(page.locator("#result")).toBeVisible();
  await page.reload();
  await expect(page.locator("#result")).not.toBeVisible();
  await expect(page.locator("#form")).toBeHidden();
  await expect(page.locator("#showRes")).toBeVisible();
  await page.locator("#showRes").click();
  await expect(page.locator("#verdict")).toHaveText("Order filled in 1/6");
  await expect(page.locator("#sPlayed")).toHaveText("1");
  expect((await stats(page)).played).toBe(1);
});

test("the streak grows on back-to-back days and resets after a missed day", async ({page}) => {
  const d0 = todayNY();
  const play = async date => { const r = await openGame(page, {date}); await bid(page, winningBid(r)); await expect(page.locator("#result")).toBeVisible(); };
  await play(d0);
  await play(addDays(d0, 1));
  await expect(page.locator("#sStreak")).toHaveText("2");
  await play(addDays(d0, 3));
  await expect(page.locator("#sStreak")).toHaveText("1");
  await expect(page.locator("#sBest")).toHaveText("2");
  await expect(page.locator("#sPlayed")).toHaveText("3");
  // The guesses-to-win chart counts every daily this browser finished.
  await expect(page.locator("#dist li").first().locator("b")).toHaveText("3");
});

test("a new local day brings a new round", async ({page}) => {
  const d0 = todayNY(), d1 = addDays(d0, 1);
  const r0 = await openGame(page, {date: d0});
  await bid(page, winningBid(r0));
  await page.clock.setFixedTime(noonNY(d1));
  await page.reload();
  const r1 = roundFor(d1);
  await expect(page.locator("#no")).toHaveText("#" + r1.day);
  await expect(page.locator("#form")).toBeVisible();
  await expect(page.locator("#lcount")).toHaveText("0 of 6");
});

test("share copies the result to the clipboard", async ({page, context, browserName}, info) => {
  test.skip(browserName !== "chromium" || info.project.name.startsWith("phone"), "clipboard permissions are Chromium desktop only");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const r = await openGame(page);
  await bid(page, winningBid(r));
  await page.locator("#copy").click();
  await expect(page.locator("#copy")).toHaveText("Copied!");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(await page.locator("#shareText").textContent());
});

test("the results pop-up closes with the button, Escape and a backdrop tap", async ({page}) => {
  const r = await openGame(page);
  await bid(page, winningBid(r));
  const dlg = page.locator("#result");
  await expect(dlg).toBeVisible();
  await page.locator("#closeRes").click();
  await expect(dlg).not.toBeVisible();
  await page.locator("#showRes").click();
  await page.keyboard.press("Escape");
  await expect(dlg).not.toBeVisible();
  await page.locator("#showRes").click();
  await page.mouse.click(2, 2);
  await expect(dlg).not.toBeVisible();
  // The page scrolls again once it's closed.
  expect(await page.evaluate(() => document.documentElement.classList.contains("modal-open"))).toBe(false);
});

test("the countdown to the next item runs on the results", async ({page}) => {
  const r = await openGame(page);
  await bid(page, winningBid(r));
  await expect(page.locator("#next")).toBeVisible();
  await expect(page.locator("#nextIn")).toHaveText(/^1[12]:\d\d:\d\d$/); // noon local, so about 12 hours left
});

test("the game still works with storage blocked", async ({page}) => {
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException("blocked", "SecurityError"); };
    Object.defineProperty(window, "localStorage", {get: deny});
  });
  const r = await openGame(page);
  await bid(page, winningBid(r));
  await expect(page.locator("#verdict")).toHaveText("Order filled in 1/6");
});
