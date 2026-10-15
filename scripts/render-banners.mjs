// Renders the profile banners from promo/header.html and promo/youtube-banner.html into promo/banners/ (needs promo served on :8124).
// X header 1500x500, Bluesky banner 3000x1000 (the same layout at 2x) and YouTube channel art 2560x1440.
// Also the link preview image (og.png) at the repo root.
import {chromium} from "playwright";
import {mkdirSync} from "node:fs";
mkdirSync("promo/banners",{recursive:true});
const b=await chromium.launch();
for(const [page,w,h,scale,name] of [["header",1500,500,1,"x-header-1500x500"],["header",1500,500,2,"bluesky-banner-3000x1000"],["youtube-banner",2560,1440,1,"youtube-banner-2560x1440"],
    ["og",1200,630,1,"../../og"]]){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:scale});
  p.on("pageerror",e=>{console.error(e);process.exitCode=1});
  await p.goto(`http://localhost:8124/${page}.html`,{waitUntil:"networkidle"});
  await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
  await p.screenshot({path:`promo/banners/${name}.png`});
  await p.close(); console.log("wrote",name);
}
await b.close();
