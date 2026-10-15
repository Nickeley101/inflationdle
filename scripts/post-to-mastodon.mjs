// Posts out/card.png with the text in out/post.txt to Mastodon (run scripts/daily-card.mjs first).
// Needs two values as env vars: MASTODON_URL (the server, e.g. https://mastodon.social) and
// MASTODON_TOKEN (Preferences → Development → New application, scopes write:media and write:statuses).
// Without them, or with DRY_RUN=1, it prints what it would post and exits without posting.
// A dry run that has the keys also checks them with one account lookup.
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

async function call(url, token, body, extra = {}) {
  const res = await fetch(url, {method: body ? "POST" : "GET", body,
    headers: {Authorization: "Bearer " + token, ...(typeof body === "string" ? {"Content-Type": "application/json"} : {}), ...extra}});
  const txt = await res.text();
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
  const server = (process.env.MASTODON_URL || "").replace(/\/+$/, ""), token = process.env.MASTODON_TOKEN;
  const haveKeys = Boolean(server && token);
  if (process.env.DRY_RUN === "1" && haveKeys) {
    const me = await call(server + "/api/v1/accounts/verify_credentials", token);
    console.log(`Mastodon keys work: signed in as @${me.acct}.`);
  }
  if (!existsSync(path.join(out, "post.txt"))) { console.log("No card was built today; nothing to post."); return; }
  const xText = readFileSync(path.join(out, "post.txt"), "utf8").trim();
  // Links are free on Mastodon, so the X post's "link in bio" line becomes a real link.
  const text = xText.replace(/^(Play free, l|L)ink in bio$/m, "Play at https://inflationdle.com") + "\n\n#Inflationdle #inflation #dailygame";
  const alt = "Inflationdle answer card with a price chart. " + xText.split("\n\n")[0].split("\n").slice(1).join(". ");
  const png = readFileSync(path.join(out, "card.png"));
  if (process.env.DRY_RUN === "1" || !haveKeys) {
    console.log("Dry run (DRY_RUN=1 or Mastodon keys not set). Would post:\n\n" + text + `\n\n+ card.png (${png.length} bytes), alt: ${alt}`);
    return;
  }
  const form = new FormData();
  form.append("file", new Blob([png], {type: "image/png"}), "card.png");
  form.append("description", alt);
  let media = await call(server + "/api/v2/media", token, form);
  // A 202 means the server is still processing the image; wait for it before attaching.
  for (let i = 0; !media.url && i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    media = await call(server + "/api/v1/media/" + media.id, token);
  }
  // The idempotency key makes a same-day re-run return the earlier post instead of posting twice.
  const post = await call(server + "/api/v1/statuses", token, JSON.stringify({status: text, media_ids: [media.id], language: "en"}),
    {"Idempotency-Key": "inflationdle-" + new Date().toISOString().slice(0, 10)});
  console.log(`Posted ${post.url}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
