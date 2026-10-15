// Live visitor counter ("odometer" under the game). Counts each browser once per day (midnight to midnight U.S. Eastern) and polls for new visitors.
(() => {
  const box = document.getElementById("visits");
  if (!box || !window.fetch) return;
  const odo = document.getElementById("vOdo");
  const todayEl = document.getElementById("vToday");
  const MIN_DIGITS = 6;
  const POLL_MS = 15000;
  let shown = -1;

  const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const store = {
    get() { try { return localStorage.getItem("ifd-visit-day"); } catch { return null; } },
    set(v) { try { localStorage.setItem("ifd-visit-day", v); } catch {} },
  };

  function build(len) {
    odo.textContent = "";
    for (let i = 0; i < len; i++) {
      const col = document.createElement("span");
      col.className = "odo-d";
      const strip = document.createElement("span");
      strip.className = "odo-s";
      strip.textContent = "0123456789".split("").join("\n");
      col.append(strip);
      odo.append(col);
    }
  }

  function render({ total, today }) {
    if (!Number.isFinite(total)) return;
    const digits = String(total).padStart(MIN_DIGITS, "0");
    if (odo.children.length !== digits.length) build(digits.length);
    [...odo.children].forEach((col, i) => {
      col.firstChild.style.transform = `translateY(${-Number(digits[i]) * 10}%)`;
    });
    odo.setAttribute("aria-label", `${total.toLocaleString("en-US")} visitors`);
    todayEl.textContent = `▲ +${(today || 0).toLocaleString("en-US")} today`;
    if (shown >= 0 && total > shown) {
      box.classList.remove("tick");
      void box.offsetWidth; // restart the flash animation
      box.classList.add("tick");
    }
    shown = total;
    box.hidden = false;
  }

  async function call(method) {
    const res = await fetch("/api/visitors", { method, cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function start() {
    try {
      const d = day();
      if (store.get() !== d) {
        render(await call("POST"));
        store.set(d);
      } else {
        render(await call("GET"));
      }
    } catch {
      return; // counter isn't available (local preview, outage): keep it hidden
    }
    setInterval(() => {
      if (document.visibilityState === "visible") call("GET").then(render, () => {});
    }, POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") call("GET").then(render, () => {});
    });
  }

  start();
})();

// Links from our profiles and posts carry ?ref=<source> so we can tell which platform visitors come from (in-app
// browsers often hide the referrer). Report it once per browser, source and day, then drop it from the address bar
// so a copied link doesn't carry it on.
(() => {
  let src;
  try { src = new URL(location.href).searchParams.get("ref"); } catch { return; }
  if (!src || !/^[a-z]{1,12}$/.test(src)) return;
  const url = new URL(location.href);
  url.searchParams.delete("ref");
  try { history.replaceState(history.state, "", url.pathname + url.search + url.hash); } catch {}
  const key = "ifd-ref-" + src, d = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  try { if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); } catch {}
  if (window.fetch) fetch("/api/ref?src=" + src, { method: "POST", keepalive: true }).catch(() => {});
})();
