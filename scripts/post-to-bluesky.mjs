// Posts out/card.png with the text in out/post.txt to Bluesky (run scripts/daily-card.mjs first).
// Needs two values as env vars: BLUESKY_HANDLE (e.g. inflationdle.bsky.social) and
// BLUESKY_APP_PASSWORD (Settings → Privacy and security → App passwords; never the account password).
// Without them, or with DRY_RUN=1, it prints what it would post and exits without posting.
// A dry run that has the keys also checks them by signing in.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

export const SERVICE = process.env.BLUESKY_SERVICE || "https://bsky.social";
const SITE = "inflationdle.com";

// Links are free on Bluesky, so the X post's "link in bio" line becomes a real link.
// The link carries ?ref=bsky so the site counts visits from Bluesky; the visible text stays the bare domain.
export function blueskyText(xText) {
  const text = xText.replace(/^(Play free, l|L)ink in bio$/m, `Play at ${SITE}`);
  const bytes = s => Buffer.byteLength(s, "utf8");
  const at = text.lastIndexOf(SITE);
  const facets = at < 0 ? [] : [{
    index: {byteStart: bytes(text.slice(0, at)), byteEnd: bytes(text.slice(0, at)) + bytes(SITE)},
    features: [{$type: "app.bsky.richtext.facet#link", uri: `https://${SITE}/?ref=bsky`}],
  }];
  // Bluesky allows 300 graphemes per post.
  const graphemes = [...new Intl.Segmenter("en", {granularity: "grapheme"}).segment(text)].length;
  if (graphemes > 300) throw new Error(`Post text is ${graphemes} graphemes, over Bluesky's 300 limit.`);
  return {text, facets};
}

export async function xrpc(method, body, token, contentType = "application/json") {
  const res = await fetch(`${SERVICE}/xrpc/${method}`, {method: "POST", body,
    headers: {"Content-Type": contentType, ...(token ? {Authorization: "Bearer " + token} : {})}});
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} → ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

export async function signIn() {
  const handle = process.env.BLUESKY_HANDLE, password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) return null;
  return xrpc("com.atproto.server.createSession", JSON.stringify({identifier: handle, password}));
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
  const haveKeys = Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);
  if (process.env.DRY_RUN === "1" && haveKeys) console.log(`Bluesky keys work: signed in as @${(await signIn()).handle}.`);
  if (!existsSync(path.join(out, "post.txt"))) { console.log("No card was built today; nothing to post."); return; }
  const xText = readFileSync(path.join(out, "post.txt"), "utf8").trim();
  const {text, facets} = blueskyText(xText);
  // Alt text: the answer lines of the post, which say what the card shows.
  const alt = "Inflationdle answer card with a price chart. " + xText.split("\n\n")[0].split("\n").slice(1).join(". ");
  const png = readFileSync(path.join(out, "card.png"));
  if (process.env.DRY_RUN === "1" || !haveKeys) {
    console.log("Dry run (DRY_RUN=1 or Bluesky keys not set). Would post:\n\n" + text + `\n\n+ card.png (${png.length} bytes), alt: ${alt}`);
    return;
  }
  const session = await signIn();
  const {blob} = await xrpc("com.atproto.repo.uploadBlob", png, session.accessJwt, "image/png");
  const post = await xrpc("com.atproto.repo.createRecord", JSON.stringify({
    repo: session.did, collection: "app.bsky.feed.post",
    record: {$type: "app.bsky.feed.post", text, facets, langs: ["en"], createdAt: new Date().toISOString(),
      embed: {$type: "app.bsky.embed.images", images: [{alt, image: blob, aspectRatio: {width: 1200, height: 675}}]}},
  }), session.accessJwt);
  console.log(`Posted https://bsky.app/profile/${session.handle}/post/${post.uri.split("/").pop()}`);
  // Marks the day as done so the workflow's backup runs don't post it again.
  writeFileSync(path.join(out, "posted-bluesky"), post.uri + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
