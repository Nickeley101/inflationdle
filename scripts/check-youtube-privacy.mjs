// Checks that the channel's latest Shorts are still public. YouTube can lock uploads from an
// unaudited API project to private, sometimes after the upload looked fine.
// Needs YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (youtube.readonly scope). Without them it exits quietly.
// Prints a GitHub warning (and a job summary line) per video that isn't public; never fails the job.
import {appendFileSync} from "node:fs";

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN})});
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token refresh → ${res.status}: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function get(url, token) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/" + url, {headers: {Authorization: "Bearer " + token}});
  const body = await res.json();
  if (!res.ok) throw new Error(`${url.split("?")[0]} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN)) {
    console.log("No YouTube keys; skipping the privacy check."); return;
  }
  const token = await accessToken();
  const ch = await get("channels?part=contentDetails&mine=true", token);
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) { console.log("No uploads playlist found."); return; }
  const list = await get(`playlistItems?part=contentDetails&maxResults=10&playlistId=${uploads}`, token);
  const ids = (list.items ?? []).map(i => i.contentDetails.videoId);
  if (!ids.length) { console.log("No uploads yet."); return; }
  const vids = await get(`videos?part=status,snippet&id=${ids.join(",")}`, token);
  let bad = 0;
  for (const v of vids.items ?? []) {
    const s = v.status, url = `https://youtube.com/shorts/${v.id}`;
    const ok = s.privacyStatus === "public" && !["rejected", "failed", "deleted"].includes(s.uploadStatus);
    console.log(`${ok ? "ok  " : "BAD "} ${url} privacy=${s.privacyStatus} upload=${s.uploadStatus}` +
      (s.rejectionReason ? ` rejection=${s.rejectionReason}` : "") + ` "${v.snippet.title}"`);
    if (!ok) {
      bad++;
      console.log(`::warning title=YouTube Short not public::${url} is ${s.privacyStatus} (${s.uploadStatus}${s.rejectionReason ? ", " + s.rejectionReason : ""})`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `- YouTube Short not public: ${url} is ${s.privacyStatus} (${s.uploadStatus})\n`);
    }
  }
  console.log(bad ? `YT_PRIVACY_ALERT: ${bad} of the latest ${ids.length} Shorts are not public.` : `All ${ids.length} latest Shorts are public.`);
}

main().catch(e => { console.log(`::warning title=YouTube privacy check failed::${e.message}`); });
