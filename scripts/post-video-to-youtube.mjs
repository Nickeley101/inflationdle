// Uploads out/video.mp4 (from scripts/daily-video.mjs) to YouTube as a Short.
// Needs three values as env vars, from a Google Cloud project with the YouTube Data API v3 turned on
// (see the YouTube and Drive setup notes): YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (scope youtube.upload + youtube.readonly).
// Without them, or with DRY_RUN=1, it prints what it would upload and exits without uploading.
// A dry run that has the keys also checks them by looking up the channel.
// Note: until Google audits the API project, YouTube keeps every API upload private.
import {readFileSync, appendFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN})});
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token refresh → ${res.status}: ${JSON.stringify(body)}` +
    (body.error === "invalid_grant" ? " (the refresh token expired or was revoked; make a new one, see the YouTube and Drive setup notes)" : ""));
  return body.access_token;
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
  const haveKeys = Boolean(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);
  if (process.env.DRY_RUN === "1" && haveKeys) {
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      {headers: {Authorization: "Bearer " + await accessToken()}});
    const body = await res.json();
    if (!res.ok) throw new Error(`channels → ${res.status}: ${JSON.stringify(body)}`);
    console.log(`YouTube keys work: signed in as the channel "${body.items?.[0]?.snippet?.title ?? "(none)"}".`);
  }
  if (!existsSync(path.join(out, "video.mp4"))) { console.log("No video was built today; nothing to upload."); return; }
  const meta = JSON.parse(readFileSync(path.join(out, "video.json"), "utf8"));
  const mp4 = readFileSync(path.join(out, "video.mp4"));
  const resource = {
    snippet: {title: meta.title.slice(0, 100), description: meta.caption.replace(/Link in bio\./, "Play at inflationdle.com"),
      tags: ["inflation", "prices", "guess the price", "daily game", "inflationdle"], categoryId: "20"},
    status: {privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: false},
  };
  if (process.env.DRY_RUN === "1" || !haveKeys) {
    console.log("Dry run (DRY_RUN=1 or YouTube keys not set). Would upload:\n\n" + JSON.stringify(resource.snippet, null, 2) + `\n\n+ video.mp4 (${mp4.length} bytes)`);
    return;
  }
  const token = await accessToken();
  // Resumable upload: send the metadata, then the file to the URL YouTube returns.
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST", body: JSON.stringify(resource),
    headers: {Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(mp4.length)}});
  if (!start.ok) throw new Error(`YouTube upload start → ${start.status}: ${await start.text()}`);
  const put = await fetch(start.headers.get("location"), {method: "PUT", body: mp4, headers: {"Content-Type": "video/mp4"}});
  const video = await put.json();
  if (!put.ok) throw new Error(`YouTube upload → ${put.status}: ${JSON.stringify(video)}`);
  console.log(`Uploaded https://youtube.com/shorts/${video.id} (${video.status?.privacyStatus})`);
  // Marks the day as done so the workflow's backup runs don't post it again.
  appendFileSync(path.join(out, "posted-video"), "youtube " + video.id + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
