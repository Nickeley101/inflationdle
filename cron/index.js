// On-time timer for the daily posts. GitHub often starts scheduled workflows late or skips them, so this
// Cloudflare Worker's cron triggers start each workflow at its time with a workflow_dispatch instead.
// Each workflow still has its own GitHub schedule as a backup; `scheduled: true` turns on the same
// "already posted today?" check those backup runs use, so whichever run goes first is the only one that posts.
// Needs one secret, GITHUB_TOKEN: a fine-grained token for Nickeley101/inflationdle with Actions read and write.

const REPO = "Nickeley101/inflationdle";

// Cron (UTC, exactly as in wrangler.jsonc) -> workflow file. Times match each workflow's first GitHub cron.
const JOBS = {
  "10 12 * * *": "daily-video-post.yml",  // yesterday's answer video, about 8 AM Eastern
  "0 13 * * *": "daily-x-post.yml",       // answer card to X, 9 AM Eastern
  "5 13 * * *": "daily-social-post.yml",  // answer card to Bluesky
  "0 16 * * *": "daily-teaser-post.yml",  // today's teaser, noon Eastern
  "30 22 * * *": "daily-evening-post.yml", // evening then-vs-now video, 6:30 PM Eastern
};

async function dispatch(workflow, token) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`;
  const body = JSON.stringify({ref: "main", inputs: {dry_run: false, scheduled: true}});
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {method: "POST", body, headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "inflationdle-cron",
      "Content-Type": "application/json",
    }});
    if (res.status === 204) { console.log(`started ${workflow}`); return; }
    const text = await res.text();
    console.error(`${workflow}: attempt ${attempt} got ${res.status} ${text.slice(0, 300)}`);
    if (res.status < 500 && res.status !== 429) break; // a bad token or input won't fix itself
    await new Promise(r => setTimeout(r, attempt * 5000));
  }
  throw new Error(`could not start ${workflow}`);
}

export default {
  async scheduled(event, env, ctx) {
    const workflow = JOBS[event.cron];
    if (!workflow) throw new Error(`no job for cron "${event.cron}"`);
    if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN secret is missing");
    await dispatch(workflow, env.GITHUB_TOKEN);
  },
  // No public endpoint: the timer only acts on its own schedule.
  async fetch() { return new Response("Not found", {status: 404}); },
};
