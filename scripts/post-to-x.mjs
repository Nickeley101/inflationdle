// Posts out/card.png with the text in out/post.txt to X (run scripts/daily-card.mjs first).
// Needs four keys from the X developer portal (app with Read and Write permission), as env vars:
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
// Without them, or with DRY_RUN=1, it prints what it would post and exits without posting.
// A dry run that has the keys also checks them with one account lookup.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {createHmac, randomBytes} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// OAuth 1.0a header (HMAC-SHA1). Only query-string and oauth_* params are signed: JSON and multipart bodies are not.
export function oauthHeader(method, url, keys, extra = {}, nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000)) {
  const u = new URL(url);
  const oauth = {oauth_consumer_key: keys.apiKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp), oauth_token: keys.accessToken, oauth_version: "1.0"};
  const params = {...Object.fromEntries(u.searchParams), ...extra, ...oauth};
  const paramStr = Object.keys(params).map(k => [enc(k), enc(params[k])]).sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)
    .map(([k, v]) => k + "=" + v).join("&");
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(paramStr)].join("&");
  const sig = createHmac("sha1", enc(keys.apiSecret) + "&" + enc(keys.accessSecret)).update(base).digest("base64");
  return "OAuth " + Object.entries({...oauth, oauth_signature: sig}).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

async function call(method, url, keys, body) {
  const res = await fetch(url, {method, body, headers: {Authorization: oauthHeader(method, url, keys),
    ...(typeof body === "string" ? {"Content-Type": "application/json"} : {})}});
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
  const keys = {apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET};
  const haveKeys = Object.values(keys).every(Boolean);
  // A dry run with keys present checks them (one account lookup, no post), so bad keys show up before the morning post.
  if (process.env.DRY_RUN === "1" && haveKeys) {
    const me = await call("GET", "https://api.x.com/2/users/me", keys);
    console.log(`X keys work: signed in as @${me.data.username}.`);
  }
  if (!existsSync(path.join(out, "post.txt"))) { console.log("No card was built today; nothing to post."); return; }
  const text = readFileSync(path.join(out, "post.txt"), "utf8").trim();
  // X auto-links bare domains too, and the API charges much more for a post with a link, so refuse to send one.
  if (/https?:\/\/|\b[a-z0-9-]+\.(com|net|org|io|co|app|dev)\b/i.test(text)) throw new Error("Post text contains a link; remove it (links cost extra on the X API).");
  const png = readFileSync(path.join(out, "card.png"));
  if (process.env.DRY_RUN === "1" || !haveKeys) {
    console.log("Dry run (DRY_RUN=1 or X keys not set). Would post:\n\n" + text + `\n\n+ card.png (${png.length} bytes)`);
    return;
  }
  const form = new FormData();
  form.append("media", new Blob([png], {type: "image/png"}), "card.png");
  form.append("media_category", "tweet_image");
  const media = await call("POST", "https://api.x.com/2/media/upload", keys, form);
  const mediaId = media.data?.id ?? media.media_id_string;
  if (!mediaId) throw new Error("Upload returned no media id: " + JSON.stringify(media));
  const post = await call("POST", "https://api.x.com/2/tweets", keys, JSON.stringify({text, media: {media_ids: [String(mediaId)]}}));
  console.log(`Posted https://x.com/i/web/status/${post.data.id}`);
  // Marks the day as done so the workflow's backup runs don't post it again.
  writeFileSync(path.join(out, "posted"), post.data.id + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
