// Posts out/video.mp4 (from scripts/daily-video.mjs) to Bluesky as a video post.
// Uses the same secrets as post-to-bluesky.mjs. Bluesky only accepts video from accounts with a verified email.
// Without the secrets, or with DRY_RUN=1, it prints what it would post and exits without posting.
import {readFileSync, appendFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {SERVICE, xrpc, signIn, blueskyText} from "./post-to-bluesky.mjs";

const VIDEO = "https://video.bsky.app";

async function get(url, token) {
  const res = await fetch(url, {headers: token ? {Authorization: "Bearer " + token} : {}});
  const txt = await res.text();
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${txt}`);
  return JSON.parse(txt);
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
  if (!existsSync(path.join(out, "video.mp4"))) { console.log("No video was built today; nothing to post."); return; }
  const meta = JSON.parse(readFileSync(path.join(out, "video.json"), "utf8"));
  const {text, facets} = blueskyText((meta.bsky || (meta.teaser ? [
    meta.question,
    `Today's puzzle, No. ${meta.day}. Comment your guess. Answer tomorrow.`,
    ``,
    `Link in bio`,
  ] : [
    meta.question,
    `Guess before the reveal.`,
    ``,
    meta.day ? `Inflationdle #${meta.day}. A new price to guess every day.` : `Inflationdle: a new price to guess every day.`,
    `Link in bio`,
  ])).join("\n"));
  const mp4 = readFileSync(path.join(out, "video.mp4"));
  const haveKeys = Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);
  if (process.env.DRY_RUN === "1" || !haveKeys) {
    console.log("Dry run (DRY_RUN=1 or Bluesky keys not set). Would post:\n\n" + text + `\n\n+ video.mp4 (${mp4.length} bytes), alt: ${meta.alt}`);
    return;
  }
  const session = await signIn();
  // The video service needs a short-lived token that lets it write the blob to this account's own server (PDS).
  const pds = new URL(session.didDoc?.service?.find(s => s.id.endsWith("atproto_pds"))?.serviceEndpoint || SERVICE).host;
  const {token} = await get(`${SERVICE}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent("did:web:" + pds)}` +
    `&lxm=com.atproto.repo.uploadBlob&exp=${Math.floor(Date.now() / 1000) + 1800}`, session.accessJwt);
  const up = await fetch(`${VIDEO}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(session.did)}&name=inflationdle-${meta.day ?? meta.kind}.mp4`,
    {method: "POST", body: mp4, headers: {Authorization: "Bearer " + token, "Content-Type": "video/mp4"}});
  const upBody = await up.json().catch(() => ({}));
  // 409 means this exact file was uploaded before; its job id still leads to the processed blob.
  if (!up.ok && up.status !== 409) throw new Error(`uploadVideo → ${up.status}: ${JSON.stringify(upBody)}`);
  let job = upBody.jobStatus || upBody;
  for (let i = 0; !job.blob && i < 90; i++) {
    if (job.state === "JOB_STATE_FAILED") throw new Error("Bluesky couldn't process the video: " + (job.error || job.message));
    await new Promise(r => setTimeout(r, 2000));
    job = (await get(`${VIDEO}/xrpc/app.bsky.video.getJobStatus?jobId=${job.jobId}`, session.accessJwt)).jobStatus;
  }
  if (!job.blob) throw new Error("Bluesky video processing didn't finish in 3 minutes.");
  const post = await xrpc("com.atproto.repo.createRecord", JSON.stringify({
    repo: session.did, collection: "app.bsky.feed.post",
    record: {$type: "app.bsky.feed.post", text, facets, langs: ["en"], createdAt: new Date().toISOString(),
      embed: {$type: "app.bsky.embed.video", video: job.blob, alt: meta.alt, aspectRatio: {width: 1080, height: 1920}}},
  }), session.accessJwt);
  console.log(`Posted https://bsky.app/profile/${session.handle}/post/${post.uri.split("/").pop()}`);
  // Marks the day as done so the workflow's backup runs don't post it again.
  appendFileSync(path.join(out, "posted-video"), post.uri + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
