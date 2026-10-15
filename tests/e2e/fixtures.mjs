// Shared setup for the browser tests: a fixed clock, no third-party network (fonts, analytics), and a record of
// console errors and Content-Security-Policy violations that every test checks at the end.
import {test as base, expect} from "@playwright/test";
import {roundFor} from "../lib/game-data.mjs";

// The player's local date for "now" in New York, where the tests' browsers live (playwright.config.mjs).
export const todayNY = (d = new Date()) => d.toLocaleDateString("en-CA", {timeZone: "America/New_York"});
export const addDays = (ymd, n) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// Noon in New York on that date, so the local date is the same in every browser.
export const noonNY = ymd => new Date(ymd + "T12:00:00-04:00");

export const test = base.extend({
  issues: [async ({page}, use) => {
    const issues = [];
    page.on("console", m => { if (m.type() === "error") issues.push("console: " + m.text()); });
    page.on("pageerror", e => issues.push("page error: " + e.message));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", e =>
        console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || "inline"}`));
    });
    // Tests stay offline: Google Fonts get an empty stylesheet and Cloudflare analytics is dropped.
    await page.route(/^https?:\/\/(?!localhost)/, route => {
      const u = route.request().url();
      if (u.startsWith("https://fonts.googleapis.com/")) return route.fulfill({status: 200, contentType: "text/css", body: ""});
      return route.fulfill({status: 204, body: ""});
    });
    // A test that expects a particular error (a 404 for an unknown country file) lists it here.
    const allowed = [];
    issues.allow = re => allowed.push(re);
    await use(issues);
    expect(issues.filter(i => !allowed.some(re => re.test(i))), "no console errors or CSP violations").toEqual([]);
  }, {auto: true}],
});
export {expect};

// Opens the game on a given local date (YYYY-MM-DD), optionally for a country (?c=xx).
export async function openGame(page, {date = todayNY(), country, query = ""} = {}) {
  await page.clock.setFixedTime(noonNY(date));
  const q = country ? `?c=${country}${query ? "&" + query : ""}` : query ? "?" + query : "";
  await page.goto("/" + q);
  await expect(page.locator("#item")).not.toBeEmpty();
  await expect(page.locator("#form")).toBeVisible().catch(() => {}); // a finished day hides the form
  return roundFor(date, country || "us");
}

export async function bid(page, value) {
  await page.locator("#guess").fill(String(value));
  await page.locator("#buy").click();
}

export const stats = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || "null"), "ic-stats");
