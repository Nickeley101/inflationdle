// Security and spoiler checks in a real browser: the security headers arrive, the CSP blocks nothing the site
// needs, private files 404, and a live round's answer isn't findable from the price pages.
import {test, expect, openGame, bid} from "./fixtures.mjs";
import {liveSyms, pricePages, winningBid} from "../lib/game-data.mjs";

test.describe.configure({mode: "parallel"});
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-chromium", "browser-independent; runs once"));

test("the game page gets its security headers", async ({page}) => {
  const res = await page.goto("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["strict-transport-security"]).toMatch(/max-age=\d+/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBeTruthy();
  expect(h["permissions-policy"]).toBeTruthy();
});

test("every kind of page loads without CSP violations or errors", async ({page}) => {
  // The fixture fails the test on any CSP violation or console error.
  const pages = ["/", "/?c=jp", "/prices/", "/privacy.html", ...Object.keys(pricePages()).filter(p => !liveSyms().has(pricePages()[p])).slice(0, 12)];
  for (const p of pages) {
    const res = await page.goto(p);
    expect(res.status(), p).toBe(200);
    await page.waitForLoadState("networkidle");
  }
});

test("private files and folders aren't served", async ({request}) => {
  for (const p of ["/scripts/schedule.mjs", "/.github/workflows/tests.yml",
    "/worker/index.js", "/worker/schema.sql", "/wrangler.jsonc", "/cron/index.js", "/README.md", "/tests/server.mjs",
    "/tests/package.json", "/.git/config", "/.assetsignore", "/_headers", "/promo/header.html", "/.env"]) {
    const res = await request.get(p, {maxRedirects: 0});
    expect(res.status(), p).toBe(404);
  }
});

test("a live item's price history is hidden in the browser too", async ({page, issues}) => {
  issues.allow(/status of 503/);
  const live = liveSyms(), pages = pricePages();
  const hidden = Object.keys(pages).filter(p => live.has(pages[p]));
  test.skip(!hidden.length, "no live item has a price page right now");
  for (const p of hidden) {
    const res = await page.goto(p);
    expect(res.status(), p).toBe(503);
    await expect(page.locator("body")).toContainText("Hidden during today's round");
    await expect(page.locator("table")).toHaveCount(0);
  }
  await page.goto("/prices/");
  for (const sym of live) await expect(page.locator(`tr[data-sym="${sym}"]`)).toHaveCount(0);
  for (const p of hidden) await expect(page.locator(`a[href="${p}"], a[href="${p}.html"]`)).toHaveCount(0);
});

test("the game stores only the player's own bids, never the answer", async ({page}) => {
  const r = await openGame(page);
  await bid(page, (r.p * 3 + 1).toFixed(2));
  const stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  const answer = winningBid(r);
  for (const [k, v] of Object.entries(stored)) expect(v, k).not.toContain(answer);
});

test("the page can't be framed by another site", async ({page}) => {
  const res = await page.goto("/");
  expect(res.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
});
