// Saves out/video.mp4 and its TikTok caption (from scripts/daily-video.mjs) to a Google Drive folder,
// so they can be posted to TikTok from a phone. The folder is "Inflationdle TikTok" in My Drive; it is
// created on the first run.
// Needs YT_CLIENT_ID and YT_CLIENT_SECRET (the same Google Cloud project as YouTube, with the Drive API
// turned on) and GDRIVE_REFRESH_TOKEN, made for your own Google account with the drive.file scope
// (see the YouTube and Drive setup notes). drive.file only lets it see files it created itself, not the rest of your Drive.
// Without the token, or with DRY_RUN=1, it prints what it would save. A dry run that has the keys also checks them.
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const FOLDER = "Inflationdle TikTok";
const API = "https://www.googleapis.com/drive/v3";

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.GDRIVE_REFRESH_TOKEN})});
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token refresh → ${res.status}: ${JSON.stringify(body)}` +
    (body.error === "invalid_grant" ? " (the Drive refresh token expired or was revoked; make a new one, see the YouTube and Drive setup notes)" : ""));
  return body.access_token;
}

async function api(token, url, init = {}) {
  const res = await fetch(url, {...init, headers: {Authorization: "Bearer " + token, ...init.headers}});
  const txt = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url.split("?")[0]} → ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

async function findFolder(token) {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  return (await api(token, `${API}/files?q=${q}&fields=files(id)`)).files[0]?.id;
}

// Resumable upload: send the metadata, then the bytes to the URL Google returns.
async function upload(token, name, parent, type, bytes) {
  const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST", body: JSON.stringify({name, parents: [parent]}),
    headers: {Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(bytes.length)}});
  if (!start.ok) throw new Error(`Drive upload start → ${start.status}: ${await start.text()}`);
  const put = await fetch(start.headers.get("location"), {method: "PUT", body: bytes, headers: {"Content-Type": type}});
  if (!put.ok) throw new Error(`Drive upload → ${put.status}: ${await put.text()}`);
}

async function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
  const haveKeys = Boolean(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.GDRIVE_REFRESH_TOKEN);
  if (process.env.DRY_RUN === "1" && haveKeys) {
    const id = await findFolder(await accessToken());
    console.log(`Google Drive keys work: ${id ? `the "${FOLDER}" folder exists` : `the "${FOLDER}" folder will be made on the first real run`}.`);
  }
  if (!existsSync(path.join(out, "video.mp4"))) { console.log("No video was built; nothing to save."); return; }
  const meta = JSON.parse(readFileSync(path.join(out, "video.json"), "utf8"));
  // Same caption as the run page shows: TikTok bios can't link yet, so the domain goes in as text.
  const caption = meta.caption.replace("Link in bio.", "Play at inflationdle.com") + "\n";
  // Names sort by date, e.g. "2026-09-28 answer No. 3.mp4", "2026-09-28 answer No. 3 caption.txt" and "2026-09-28 evening.mp4".
  const base = `${new Date().toISOString().slice(0, 10)} ${meta.kind || (meta.teaser ? "teaser" : "answer")}${meta.day ? ` No. ${meta.day}` : ""}`;
  const mp4 = readFileSync(path.join(out, "video.mp4"));
  if (process.env.DRY_RUN === "1" || !haveKeys) {
    console.log(`Dry run (DRY_RUN=1 or Drive keys not set). Would save to "${FOLDER}":\n  ${base}.mp4 (${mp4.length} bytes)\n  ${base} caption.txt:\n\n${caption}`);
    return;
  }
  const token = await accessToken();
  const folder = await findFolder(token) || (await api(token, `${API}/files?fields=id`, {method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({name: FOLDER, mimeType: "application/vnd.google-apps.folder"})})).id;
  await upload(token, `${base}.mp4`, folder, "video/mp4", mp4);
  await upload(token, `${base} caption.txt`, folder, "text/plain", Buffer.from(caption));
  console.log(`Saved "${base}.mp4" and its caption to the "${FOLDER}" folder in Google Drive.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
