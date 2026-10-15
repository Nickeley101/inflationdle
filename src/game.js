// Inflationdle. U.S. price data lives in data/prices.json; other countries each have data/countries/<code>.json.
"use strict";
// data/cpi.json and data/schedule.json are optional: without them the results skip the inflation line
// and the daily falls back to a shuffled order.
const opt=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
// Country: ?c=jp in the link wins, then the player's last pick, then the browser's region (ja-JP plays Japan) when
// that country has a daily, else the U.S. game. Each country has its own daily, numbering, streak and stats.
// The U.S. keeps its original storage keys so existing streaks carry on.
const PICK=(()=>{let c=(new URLSearchParams(location.search).get("c")||"").toLowerCase(),auto=false;
  if(!c)try{c=localStorage.getItem("ic-country")||""}catch(e){}
  if(!c){auto=true;const L=navigator.languages||[navigator.language||""],r=L.map(l=>/-([a-z]{2})$/i.exec(l)).find(Boolean);
    c=r?r[1]:({ja:"jp",ko:"kr"})[(L[0]||"").slice(0,2)]||"us";c=c.toLowerCase()}
  return {c:/^[a-z]{2}$/.test(c)?c:"us",auto}})();
const LISTED=opt("data/countries/index.json");
const usData=()=>Promise.all(["us",fetch("data/prices.json").then(r=>r.json()),opt("data/cpi.json"),opt("data/schedule.json")]);
const load0=(PICK.auto?LISTED.then(L=>Array.isArray(L)&&L.some(x=>x.code===PICK.c)?PICK.c:"us"):Promise.resolve(PICK.c)).then(c=>c==="us"?usData()
  :Promise.all([c,fetch("data/countries/"+c+".json").then(r=>{if(!r.ok)throw 0;return r.json()}),null,opt("data/countries/"+c+".schedule.json")])
  .catch(()=>{try{localStorage.removeItem("ic-country")}catch(e){}return usData()}));
Promise.all([load0,LISTED]).then(([[COUNTRY,DATA,CPI,SCHED],LIST])=>{
const US=COUNTRY==="us";
const ALL=DATA.series;
// Currency and grading floors: the U.S. game uses dollars with cent floors; a country file names its own.
const CUR=US?{code:"USD",locale:"en-US",decimals:2,hitMin:.02,warmMin:.05}:{code:DATA.currency,locale:DATA.locale,decimals:DATA.decimals??2,hitMin:DATA.hitMin,warmMin:DATA.warmMin};
// Skip series without at least two data points (e.g. a metro added but not yet refreshed).
const SERIES=ALL.filter(s=>(s.pts||s.v||[]).filter(x=>x!=null).length>=2);
// Every U.S. market says so for players abroad ("Chicago area, US", "U.S. South (urban)"); other countries name
// the country after the city unless the location already is the country.
const market=s=>!US?(s.loc===DATA.name?s.loc:s.loc+", "+DATA.name):s.loc==="U.S. City Average"?"U.S. average":/U\.S\./.test(s.loc)?s.loc:/^(South|West|Northeast|Midwest) /.test(s.loc)?"U.S. "+s.loc:s.loc+", US";
SERIES.forEach(s=>{
  if(!s.pts)s.pts=s.v.map((p,i)=>[s.start+i,p]).filter(x=>x[1]!=null);
  s.last=s.pts[s.pts.length-1];
  // "Now" price: newest monthly BLS value when the data has one ({period:"YYYY-MM", value}), else the newest yearly point.
  const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if(s.latest){const [yy,mm]=s.latest.period.split("-").map(Number);s.now={p:s.latest.value,label:MON[mm-1]+" "+yy,x:yy+(mm-1)/12}}
  else s.now={p:s.last[1],label:s.id?"Jan "+s.last[0]:!US&&s.last[3]?s.last[3].replace(/^(\w{3})\w*/,"$1"):s.last[0]+"",x:s.last[0]};
});

// Round pool: every published January except each series' latest one.
const POOL=[];
SERIES.forEach((s,si)=>s.pts.slice(0,-1).forEach(([y,p,name,date])=>POOL.push({si,y,p,name,date})));

function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const ORDER=(()=>{const r=rng(20260925),a=POOL.map((_,i)=>i);for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a})();

// Each country's daily #1 is its own launch day (the "epoch" in its file).
const EPOCH=US?Date.UTC(2026,8,25):Date.parse(DATA.epoch+"T00:00:00Z");
function dayNumber(){const n=new Date();return Math.floor((Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())-EPOCH)/864e5)+1}
const DAY=Math.max(1,dayNumber());
// Daily pick: data/schedule.json names each day's round ("SYM:year"), planned by scripts/schedule.mjs, so new
// price data never changes a day that is already live. A day it doesn't cover falls back to a shuffled order.
const key=r=>SERIES[r.si].sym+":"+r.y;
const roundOf=d=>{const k=SCHED&&SCHED.days&&SCHED.days[d-1],i=k?POOL.findIndex(r=>key(r)===k):-1;return i>=0?i:ORDER[(d-1)%ORDER.length]};
const TODAY=roundOf(DAY);

const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const DAYKEY=US?"ic2-day-":"ic2-"+COUNTRY+"-day-", STATS=US?"ic-stats":"ic-stats-"+COUNTRY;

const $=id=>document.getElementById(id);
const money=(p,d)=>new Intl.NumberFormat(CUR.locale,{style:"currency",currency:CUR.code,minimumFractionDigits:d,maximumFractionDigits:d}).format(p);
const fmt=p=>US?"$"+(p<1?p.toFixed(3).replace(/0$/,""):p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})):money(p,CUR.decimals);
const cents=p=>US?"$"+p.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):money(p,CUR.decimals);
// Axis labels: short money ("$1.5k", "¥250").
const axis=v=>v===0?money(0,0):v>=10000?money(v/1000,1).replace(/(\d)(?=\D*$)/,"$1k"):v>=100||!CUR.decimals?money(Math.round(v),0):money(v,2);
const label=(s,pt)=>pt[2]||s.name;
// "Now" label on the results screen: BLS month, newest launch, current subscription price, or the newest survey month.
const nowLbl=s=>!US?"Price in "+s.now.label:s.id?"Price in "+s.now.label:s.cat==="Electronics"?"Latest launch":s.cat==="Cars"?"Latest base price":(s.cat==="Subscriptions"||s.steps)?"Price now":"Price in "+s.last[3].replace(/^(\w{3})\w*/,"$1");
// Electronics rows may carry a source URL as their 5th field; link the one for this round.
const srcUrl=s=>{const u=(s.pts.find(p=>p[0]===round.y)||[])[4];return /^https:\/\//.test(u||"")?u:null};
const MAXG=6;
let mode="daily", round, guesses=[], done=false;

function tape(){
  // Lines no longer sold (`ended`) stay playable but leave the tape, which reads as prices today. The newest
  // price shows its month ("Oct 2025"), not just its year, so an older one never passes for this month's. Cars keep
  // their model year, which is what the first price shows too.
  // Today's daily item stays off the tape too: its first price can be the very answer (Big Mac 1986).
  const live=SERIES[POOL[TODAY].si].sym.split(".")[0];
  const items=SERIES.filter(s=>!s.ended&&(s.loc!=="U.S. City Average"?!s.id:true)&&s.sym.split(".")[0]!==live).map(s=>{
    const first=s.pts[0],pct=(s.now.p/first[1]-1)*100,when=!s.latest&&s.last[3]&&s.cat!=="Cars"?s.last[3].replace(/^(\w{3})\w*/,"$1"):s.now.label;
    return `<span class="tape-item"><b>${s.sym}</b><span>${first[0]} ${fmt(first[1])}</span><span>→</span><span>${when} ${fmt(s.now.p)}</span><em class="${pct>=0?'pos':'neg'}" style="font-style:normal">${pct>=0?'▲':'▼'}${Math.abs(pct).toFixed(0)}%</em></span>`}).join("");
  $("tape").innerHTML=items+items;
  // Fixed speed, not fixed duration: the tape stays at a calm 60px a second however many series it lists.
  const pace=()=>{$("tape").style.animationDuration=Math.max(30,$("tape").scrollWidth/2/60)+"s"};
  pace(); if(document.fonts)document.fonts.ready.then(pace);
}

// Short form of a "per" unit for the end of the bid box ("per kilowatt-hour" -> "kWh"); empty when it would be too long to fit.
const PER_SHORT={"kilowatt-hour":"kWh",gallon:"gal",pound:"lb","half gallon":"½ gal","troy ounce":"oz",liter:"L",litre:"L","letter (first ounce)":"letter","ride (base fare)":"ride"};
function perShort(u){const m=/^per ([^,]+)/.exec(u);if(!m)return "";const w=PER_SHORT[m[1]]||m[1];return w.length<=8?w:""}
function load(r){
  round=r; const s=SERIES[r.si];
  $("sym").textContent="$"+s.sym; $("item").textContent=(r.name||s.name)+" "; // The unit line carries the market unless the unit already says where ("one burger, U.S. price").
  // One quiet line, with the unit itself in bold so "Electricity" reads as a price per kWh, not a monthly bill; a short "per" unit also ends the bid box.
  const u=document.createElement("b");u.textContent=s.unit;
  const where=/U\.S\./.test(s.unit)||s.unit.toLowerCase().includes(market(s).toLowerCase())?"":market(s);
  $("unit").replaceChildren(...s.cat?[s.cat+" · "]:[],u,...where?[" · "+where]:[]);
  const per=perShort(s.unit);$("per").textContent=per?"/ "+per:"";$("per").hidden=!per;
  $("guess").setAttribute("aria-label",($("guess").dataset.lbl||"Your price guess in US dollars")+(/^per /.test(s.unit)?" "+s.unit.replace(/,.*/,""):""));
  // The round's month and year are part of the headline ("BIG MAC SEP 1986"), so nobody guesses today's price.
  const yr=document.createElement("span");yr.className="yr";yr.textContent=(r.date||"January "+r.y).replace(/^([A-Za-z]{3})[A-Za-z]*/,"$1");$("item").appendChild(yr);
  $("no").textContent=mode==="daily"?"#"+DAY:"";
  if(mode==="daily"){const saved=store.get(DAYKEY+DAY,null);guesses=saved?saved.g:[];}else guesses=[];
  done=false; bidError(""); $("guess").value=""; $("sr").textContent="";
  render();
  if(isWin()||guesses.length>=MAXG)finish(false);
}

// Bands are a percentage of the answer with a cents floor, so cheap items never need sub-cent guesses.
const HIT_PCT=.05, HIT_MIN=CUR.hitMin, WARM_PCT=.25, WARM_MIN=CUR.warmMin;
const hitFor=(g,p)=>Math.abs(g-p)<=Math.max(HIT_PCT*p,HIT_MIN)+1e-9;
function grade(g){const d=Math.abs(g-round.p),hit=d<=Math.max(HIT_PCT*round.p,HIT_MIN)+1e-9,warm=d<=Math.max(WARM_PCT*round.p,WARM_MIN)+1e-9;
  // "Close" is spelled out, not just coloured, so the grade still reads without colour vision.
  return{cls:hit?"hit":warm?"warm":"cold",dir:hit?"<i>✓</i>HIT":(g<round.p?"<i>▲</i>HIGHER":"<i>▼</i>LOWER")+(warm?'<b class="tag">CLOSE</b>':"")}}
// What the misses so far have ruled out: the answer is above every "higher" bid and below every "lower" one.
function bounds(){let lo=0,hi=Infinity;guesses.forEach(g=>{if(grade(g).cls==="hit")return;if(g<round.p)lo=Math.max(lo,g);else hi=Math.min(hi,g)});return[lo,hi]}
const isWin=()=>guesses.some(g=>grade(g).cls==="hit");

function render(){
  const lv=$("lives");lv.innerHTML="";
  // One box per bid, filled left to right in that bid's grade colour; unused boxes stay grey.
  $("lcount").textContent=`${guesses.length} of ${MAXG}`;lv.setAttribute("aria-label",`${guesses.length} of ${MAXG} guesses used`);
  for(let i=0;i<MAXG;i++){const b=document.createElement("i");b.className=i<guesses.length?grade(guesses[i]).cls:"used";lv.appendChild(b)}
  const log=$("log");log.innerHTML="";
  // The book grows like an order book: the bids so far plus one empty row for the next. The pips above show
  // each bid's grade. A lost round ends with the answer as the last row.
  const rowsN=done?guesses.length:Math.min(MAXG,guesses.length+1);
  for(let i=0;i<rowsN;i++){
    const li=document.createElement("li");
    if(i<guesses.length){const g=guesses[i],r=grade(g);li.className=r.cls;
      li.innerHTML=`<span class="n">${i+1}</span><span>${cents(g)}</span><span class="dir">${r.dir}${r.cls==="hit"?`<b class="act">Actual <em>${cents(round.p)}</em></b>`:""}</span>`;
    }else{li.className="empty";li.setAttribute("aria-hidden","true");li.innerHTML=`<span class="n">${i+1}</span><span>—</span><span></span>`}
    log.appendChild(li);
  }
  if(done&&!isWin()){const li=document.createElement("li");li.className="ans";
    li.innerHTML=`<span class="n"></span><span>${cents(round.p)}</span><span class="dir">Actual price</span>`;log.appendChild(li)}
  // The bid form goes away once the round is over; the board and "View results" stay.
  $("form").hidden=done; $("skipRow").hidden=done||mode!=="practice";
  const [lo,hi]=bounds();
  // A first-time player gets one line on how bids work, until their first bid.
  const first=!done&&!guesses.length&&!store.get("ic-bid",false);
  $("range").textContent=done?"":first?"Type a price and place a bid. Each miss tells you to go higher or lower.":lo&&hi<Infinity?`It's between ${cents(lo)} and ${cents(hi)}.`:lo?`It's above ${cents(lo)}.`:hi<Infinity?`It's below ${cents(hi)}.`:"";
  $("range").hidden=!$("range").textContent;
}
function bidError(t){$("err").textContent=t;$("err").hidden=!t;$("range").classList.toggle("muted-by-err",/^It's/.test(t));$("guess").setAttribute("aria-invalid",t?"true":"false")}

$("form").addEventListener("submit",e=>{
  e.preventDefault(); if(done)return;
  const raw=$("guess").value.replace(/[$,\s]/g,""); const g=parseFloat(raw);
  if(!(g>0)||g>1e9)return bidError(US?"Enter a price in dollars, like 1.25.":"Enter a price, like "+cents(DATA.example||1.25).replace(/[^\d.,]/g,"")+".");
  // A bid the earlier answers already rule out can't win, so it doesn't cost a guess.
  const gr=Math.round(g*10**CUR.decimals)/10**CUR.decimals, [lo,hi]=bounds();
  if(guesses.includes(gr))return bidError(`You already bid ${cents(gr)}.`);
  if(gr<=lo)return bidError(`It's above ${cents(lo)}. Bid higher.`);
  if(gr>=hi)return bidError(`It's below ${cents(hi)}. Bid lower.`);
  bidError(""); guesses.push(gr); $("guess").value=""; store.set("ic-bid",true);
  const r=grade(gr),left=MAXG-guesses.length;
  $("sr").textContent=`Bid ${guesses.length}: ${cents(gr)}. `+(r.cls==="hit"?"Hit.":(gr<round.p?"Higher":"Lower")+(r.cls==="warm"?", close.":".")+` ${left} ${left===1?"guess":"guesses"} left.`);
  if(mode==="daily")store.set(DAYKEY+DAY,{g:guesses});
  render();
  if(isWin()||guesses.length>=MAXG)finish(true); else $("guess").focus();
});

// Inflation line for the results, worded like the daily X card (scripts/daily-card.mjs) so both say the same thing.
const FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthOf=d=>{const m=/^(\w+) (\d{4})$/.exec(d||""),i=m?FULL.indexOf(m[1]):-1;return i<0?null:[+m[2],i]};
function cpiAt([y,m]){
  const [y0,m0]=CPI.start.split("-").map(Number),i=(y-y0)*12+(m-(m0-1)),at=k=>CPI.v[Math.max(0,Math.min(k,CPI.v.length-1))];
  if(i>=CPI.v.length)return at(CPI.v.length-1);
  return at(i)??(at(i-1)+at(i+1))/2; // BLS skipped Oct 2025; use the average of its neighbours
}
function inflationFact(s,chg){
  if(!CPI)return null;
  const then=round.date?monthOf(round.date):[round.y,0];
  const now=s.latest?[+s.latest.period.slice(0,4),+s.latest.period.slice(5)-1]:s.id?[s.last[0],0]:monthOf(s.last[3]);
  if(!then||!now)return null;
  const r=cpiAt(now)/cpiAt(then),infl=(r-1)*100,gap=chg-infl;
  const who=s.id?s.name.split(",")[0]:s.who||"Console prices";
  const all=infl.toFixed(0)+"%";
  const verdict=chg<0?`got cheaper, while prices overall rose ${all}`:Math.abs(gap)<5?`went up about as much as prices overall (${all})`:gap>0?`went up faster than prices overall, which rose ${all}`:`went up ${chg.toFixed(0)}%, less than prices overall (${all})`;
  return `${fmt(round.p)} then is about ${fmt(round.p*r)} in today's money. ${who} ${verdict}.`;
}

// A finished U.S. daily opens that item's price history page early (the Worker hides it while the round is live).
// Only the last few day numbers are kept; spoiler protection, not security.
function markDone(){
  if(!US||mode!=="daily")return;
  try{const m=document.cookie.match(/(?:^|; )ic_done=([\d.]+)/),d=(m?m[1].split("."):[]).map(Number).filter(n=>n>=DAY-3&&n!==DAY);
    document.cookie="ic_done="+d.concat(DAY).join(".")+"; Max-Age=345600; Path=/; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")}catch(e){}
}
function finish(fresh){
  done=true; render(); markDone();
  const s=SERIES[round.si], win=isWin();
  if(fresh&&mode==="daily"){
    const st=store.get(STATS,{played:0,wins:0,streak:0,best:0,lastDay:0});
    st.played++; if(win){st.wins++;st.streak=(st.lastDay===DAY-1?st.streak:0)+1;st.best=Math.max(st.best,st.streak)}else st.streak=0;
    st.lastDay=DAY; store.set(STATS,st);
  }
  $("verdict").textContent=win?`Order filled in ${guesses.length}/${MAXG}`:"Order expired";
  const best=guesses.reduce((a,g)=>Math.abs(g-round.p)<Math.abs(a-round.p)?g:a,guesses[0]),off=(best/round.p-1)*100;
  $("closest").hidden=win; $("closest").textContent=win?"":`Your closest bid was ${cents(best)}, ${Math.abs(off).toFixed(0)}% ${off>0?"too high":"too low"}.`;
  $("verdict").className="verdict "+(win?"win":"lose");
  const chg=(s.now.p/round.p-1)*100;
  $("rActual").textContent=fmt(round.p); if(fresh)closingBell($("rActual"),round.p,win);
  $("rNowLbl").textContent=nowLbl(s).replace(/^Price in /,"");
  $("rNow").textContent=fmt(s.now.p)+(s.id||!US?"":s.cat==="Electronics"||s.cat==="Cars"?" ("+s.now.label+")":(s.cat==="Subscriptions"||s.steps)?" (since "+s.last[3]+")":"");
  $("rChg").textContent=(chg>=0?"+":"")+chg.toFixed(0)+"%"; // plain text: green and red belong to your bids
  const f=inflationFact(s,chg); $("fact").hidden=!f; $("fact").textContent=f||"";
  $("src").innerHTML=!US?`Chart: ${s.name.toLowerCase()} ${s.unit}, ${market(s)}, not adjusted for inflation. Source: ${s.url?`<a href="${s.url}" target="_blank" rel="noopener">${s.src}</a>`:s.src}.`
    :s.id?`Source: BLS average price, ${s.name.toLowerCase()} ${s.unit}, ${market(s)}. Rounds use each January; the price shown for ${s.now.label} is that month's value. Series <a href="https://fred.stlouisfed.org/series/${s.id}" target="_blank" rel="noopener">${s.id}</a>.${CPI?" Inflation uses the U.S. CPI-U.":""}`
    :`${s.cat==="Electronics"?`Latest price is the ${s.last[2]}. Chart: U.S. launch prices across ${s.line}`:(s.cat==="Subscriptions"||s.steps)?`Price since ${s.last[3]}. Chart: ${s.line}${s.steps?"":" in the U.S."} after each price change`:s.cat==="Cars"?`Base MSRP of the cheapest version, before the destination fee, taxes and dealer markups, so buyers usually paid more. Latest is the ${s.last[2]}. Chart: base prices by model year for ${s.line}`:`Chart: ${s.line}`}, not adjusted for inflation. Source: ${s.src||"each console's Wikipedia article"}${srcUrl(s)?` (<a href="${srcUrl(s)}" target="_blank" rel="noopener">${s.pts.find(p=>p[0]===round.y)[2]||round.date+" price"}</a>)`:""}.`;
  chart(s);
  const rows=guesses.map(g=>{const r=grade(g);return(r.cls==="hit"?"🟩":r.cls==="warm"?"🟨":"🟥")+(r.cls==="hit"?"☑️":g<round.p?"⬆️":"⬇️")}).join("\n");  // one guess per line, like Wordle
  const place=!US?market(s):/^U\.S\. (launch|list|price|base)|^World/.test(s.loc)?"":s.loc==="U.S. City Average"?"U.S.":s.loc.replace(/ \(urban\)| area$/g,"").replace(/^Urban /,"");
  const what=[itemEmoji(s)+" "+(round.name||s.name).split(",")[0],place,round.date?round.date.replace(/^([A-Za-z]{3})[A-Za-z]*/,"$1"):"Jan "+round.y].filter(Boolean).join(" · ");
  $("shareText").textContent=`Inflationdle ${US?"":DATA.flag+" "}${mode==="daily"?"#"+DAY:"(practice)"} ${win?guesses.length:"X"}/${MAXG}\n${what}\n\n${rows}\n\nhttps://inflationdle.com${US?"":"/?c="+COUNTRY}`;
  const st=store.get(STATS,{played:0,wins:0,streak:0,best:0});
  $("sPlayed").textContent=st.played; $("sWin").textContent=st.played?Math.round(st.wins/st.played*100)+"%":"0%";
  $("sStreak").textContent=st.streak; $("sBest").textContent=st.best;
  const dist=winDist(),top=Math.max(1,...dist),mine=mode==="daily"&&win?guesses.length:0;
  $("dist").innerHTML=!dist.some(Boolean)?'<li class="none">No daily wins yet.</li>':dist.map((n,i)=>`<li${i+1===mine?' class="me"':""}><span>${i+1}</span><b style="width:${Math.max(7,n/top*100)}%">${n}</b></li>`).join("");
  $("next").hidden=mode!=="daily"; tickNext();
  $("again").hidden=mode!=="practice";
  // Pop the results up only right after the last guess. Coming back to a finished daily (from practice,
  // or on a reload) shows the board with the "View results" button instead.
  $("reopen").hidden=false; if(fresh)openResults();
}

// Emoji for the share text, from the item's name, else its category.
const EMOJI=[[/peanut/i,"🥜"],[/apple/i,"🍎"],[/turkey/i,"🦃"],[/pepper/i,"🫑"],[/roast/i,"🥩"],[/stamp/i,"✉️"],[/subway/i,"🚇"],[/house/i,"🏠"],[/egg/i,"🥚"],[/milk/i,"🥛"],[/bread|flour/i,"🍞"],[/beef|steak/i,"🥩"],[/coffee/i,"☕"],[/banana/i,"🍌"],[/bacon/i,"🥓"],[/chicken/i,"🍗"],[/butter/i,"🧈"],[/sugar/i,"🍬"],[/ice cream/i,"🍦"],[/\brice\b/i,"🍚"],[/cookie/i,"🍪"],[/cheese/i,"🧀"],[/orange/i,"🍊"],[/potato chip/i,"🥔"],[/potato/i,"🥔"],[/lettuce/i,"🥬"],[/tomato/i,"🍅"],[/beer/i,"🍺"],[/wine/i,"🍷"],[/lemon/i,"🍋"],[/gasoline/i,"⛽"],[/electric/i,"⚡"],[/console|handheld/i,"🎮"],[/iphone|ipad/i,"📱"],[/kindle/i,"📖"],[/ipod|airpods/i,"🎧"],[/macbook/i,"💻"],[/watch/i,"⌚"],[/gopro/i,"📷"],[/netflix|disney/i,"📺"],[/spotify/i,"🎵"],[/amazon/i,"📦"],[/pickup/i,"🛻"],[/suv|sedan/i,"🚗"],[/big mac/i,"🍔"],[/gold/i,"🥇"],[/silver/i,"🥈"]];
// Extra emoji for other countries' items, checked first there so U.S. share text stays as it is.
const EMOJI_INTL=[[/sushi/i,"🍣"],[/ramen|noodle/i,"🍜"],[/curry/i,"🍛"],[/green tea/i,"🍵"],[/tea bag/i,"🫖"],[/tuna|salmon|eel|fish/i,"🐟"],[/apple/i,"🍎"],
  [/onion/i,"🧅"],[/carrot/i,"🥕"],[/cabbage/i,"🥬"],[/cauliflower/i,"🥦"],[/avocado/i,"🥑"],[/lager|bitter/i,"🍺"],[/whisky/i,"🥃"],[/petrol|diesel|kerosene/i,"⛽"],
  [/haircut/i,"💈"],[/bowling/i,"🎳"],[/sausage/i,"🌭"],[/pork|ham/i,"🥓"],[/salt/i,"🧂"],[/ketchup|beans/i,"🥫"],[/toothpaste/i,"🪥"],[/peanut/i,"🥜"],
  [/olive|oil/i,"🫒"],[/cereal/i,"🥣"],[/formula/i,"🍼"],[/mince/i,"🥩"]];
const itemEmoji=s=>{const t=(s.line||"")+" "+s.name;const m=(US?[]:EMOJI_INTL).concat(EMOJI).find(([re])=>re.test(t));return m?m[1]:{Groceries:"🛒",Energy:"⚡",Electronics:"💻",Subscriptions:"📺",Cars:"🚗","Fast food":"🍔",Metals:"🪙",Housing:"🏠","Eating out":"🍽️",Pub:"🍺",Services:"💈",Household:"🧴"}[s.cat]||"💵"};

function chart(s){
  // Draw at the pop-up's real width (560px max, minus padding) so axis labels stay readable on phones.
  const W=Math.round(Math.max(240,Math.min(524,innerWidth-68))),H=200,L=60,R=14,T=14,B=26,pts=s.latest?[...s.pts,[s.now.x,s.now.p]]:s.pts;
  const x0=pts[0][0],x1=pts[pts.length-1][0],ys=pts.map(p=>p[1]);
  const ymin=0,ymax=Math.max(...ys)*1.1;
  const X=y=>L+(y-x0)/(x1-x0||1)*(W-L-R), Y=v=>T+(1-(v-ymin)/(ymax-ymin))*(H-T-B);
  // Prices that hold until the next change (subscriptions, stamps, fares) draw as steps, not slopes.
  const step=s.steps||s.cat==="Subscriptions";
  const line=pts.map((p,i)=>i&&step?"H"+X(p[0]).toFixed(1)+"V"+Y(p[1]).toFixed(1):(i?"L":"M")+X(p[0]).toFixed(1)+" "+Y(p[1]).toFixed(1)).join("");
  const area=line+`L${X(x1).toFixed(1)} ${Y(0)}L${X(x0).toFixed(1)} ${Y(0)}Z`;
  const col="var(--cyan)"; // not green/red: those grade your bids, and the price rising isn't a win or loss
  let g="";
  [0,.5,1].forEach(f=>{const v=ymax*f;const yy=Y(v);g+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"/><text x="${L-6}" y="${yy+3}" text-anchor="end">${US?(v===0?"$0":v>=10000?"$"+(v/1000).toFixed(1)+"k":v>=100?"$"+Math.round(v).toLocaleString("en-US"):"$"+v.toFixed(2)):axis(v)}</text>`});
  g+=`<text x="${X(x0)}" y="${H-8}" text-anchor="start">${x0}</text><text x="${X(x1)}" y="${H-8}" text-anchor="end">${Math.floor(x1)}</text>`;
  g+=`<path d="${area}" fill="${col}" fill-opacity=".08"/><path class="pl" d="${line}" fill="none" stroke="${col}" stroke-width="2"/>`;
  const px=X(round.y),py=Y(round.p);
  g+=`<line x1="${px}" x2="${px}" y1="${T}" y2="${H-B}" stroke="var(--warm)" stroke-dasharray="3 3"/><circle cx="${px}" cy="${py}" r="5" fill="var(--warm)"/>`;
  // The target's label sits in the half of the chart away from its point, so the price line doesn't run through it.
  g+=`<text x="${px+(px>W-110?-8:8)}" y="${py>(T+H-B)/2?T+10:H-B-8}" text-anchor="${px>W-110?'end':'start'}" style="fill:var(--warm-ink)" id="tgtLbl">${round.y} ${fmt(round.p)}</text>`;
  g+=`<circle cx="${X(s.now.x)}" cy="${Y(s.now.p)}" r="4" fill="${col}"/>`;
  if(!s.id&&pts.length<=20)pts.forEach(p=>{if(p[0]!==round.y&&p.length>2)g+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3" fill="${col}"/>`});
  // Crosshair for exploring the chart (drawn on top, hidden until the pointer or a key moves it).
  g+=`<g id="cx" visibility="hidden"><line y1="${T}" y2="${H-B}" stroke="var(--text)" stroke-opacity=".45"/><circle r="4.5" stroke="var(--bg)" stroke-width="2"/><rect rx="3" height="22" fill="var(--panel)" stroke="var(--line)"/><text y="${T+15}" style="fill:var(--text)"></text></g>`;
  $("chart").setAttribute("viewBox",`0 0 ${W} ${H}`); $("chart").style.aspectRatio=W+" / "+H;
  $("chart").innerHTML=g;
  const short=d=>d.replace(/^([A-Za-z]{3})[A-Za-z]*/,"$1");
  CH={W,T,X,Y,i:-1,pts:pts.map((p,i)=>({x:p[0],p:p[1],what:p[2]&&!s.id?p[2]:"",
    when:i===pts.length-1&&s.latest?s.now.label:p[3]?short(p[3]):s.id?"Jan "+p[0]:String(p[0]),me:p[0]===round.y&&p[1]===round.p}))};
  $("chart").setAttribute("aria-label",`Price chart: ${x0===round.y?"":`${fmt(pts[0][1])} in ${x0}, `}${fmt(round.p)} in ${round.y} (this round), ${fmt(s.now.p)} in ${s.now.label}.`);
}

// Exploring the chart: hover (mouse), drag (touch; vertical swipes still scroll the pop-up) or arrow keys
// move a crosshair to the nearest price and show its date and price.
let CH=null;
function chartAt(i){
  if(!CH)return; i=Math.max(0,Math.min(CH.pts.length-1,i)); CH.i=i;
  const q=CH.pts[i],x=CH.X(q.x),y=CH.Y(q.p),cx=$("cx"); if(!cx)return;
  const tx=cx.querySelector("text");tx.textContent=`${q.when}  ${fmt(q.p)}`;
  const w=Math.ceil(tx.getComputedTextLength())+14,left=x+w+8>CH.W?x-w-8:x+8;
  cx.setAttribute("visibility","visible"); $("tgtLbl").setAttribute("visibility","hidden"); // the readout takes the top row
  cx.querySelector("line").setAttribute("x1",x);cx.querySelector("line").setAttribute("x2",x);
  const c=cx.querySelector("circle");c.setAttribute("cx",x);c.setAttribute("cy",y);c.setAttribute("fill",q.me?"var(--warm)":"var(--cyan)");
  const r=cx.querySelector("rect");r.setAttribute("x",left);r.setAttribute("y",CH.T);r.setAttribute("width",w);
  tx.setAttribute("x",left+7);
  $("chartSr").textContent=`${q.when}: ${fmt(q.p)}${q.what?", "+q.what:""}${q.me?", this round":""}.`;
}
function chartHide(){const cx=$("cx");if(cx){cx.setAttribute("visibility","hidden");$("tgtLbl").setAttribute("visibility","visible")}}
function chartPoint(e){
  if(!CH)return; const b=$("chart").getBoundingClientRect(),vx=(e.clientX-b.left)*CH.W/b.width;
  let best=0;CH.pts.forEach((q,i)=>{if(Math.abs(CH.X(q.x)-vx)<Math.abs(CH.X(CH.pts[best].x)-vx))best=i});
  chartAt(best);
}
$("chart").addEventListener("pointermove",chartPoint);
$("chart").addEventListener("pointerdown",chartPoint);
$("chart").addEventListener("pointerleave",e=>{if(e.pointerType==="mouse")chartHide()});
$("chart").addEventListener("keydown",e=>{
  if(!CH)return; const n=CH.pts.length,k=e.key;
  const i=k==="ArrowRight"?CH.i+1:k==="ArrowLeft"?(CH.i<0?n-1:CH.i-1):k==="Home"?0:k==="End"?n-1:null;
  if(i===null)return; e.preventDefault(); chartAt(i);
});
$("chart").addEventListener("blur",()=>{chartHide();if(CH)CH.i=-1});

// Share like Wordle: phones copy the result and open the share sheet; elsewhere the result goes to the clipboard.
// In-app browsers (Messenger, Instagram) can block both, so the last resort shows the text to copy by hand.
const shareLabel=t=>{$("copy").textContent=t;clearTimeout(shareLabel.t);if(t!=="Share")shareLabel.t=setTimeout(()=>$("copy").textContent="Share",2500)};
function resetShare(){$("shareText").hidden=$("shareHelp").hidden=true;clearTimeout(shareLabel.t);$("copy").textContent="Share"}
function legacyCopy(t){
  const a=document.createElement("textarea");a.value=t;a.setAttribute("readonly","");a.style.cssText="position:fixed;top:0;left:0;opacity:0";
  $("result").appendChild(a);a.select();a.setSelectionRange(0,t.length);let ok=false;try{ok=document.execCommand("copy")}catch(e){}a.remove();return ok;
}
function showShareText(){
  $("shareText").hidden=$("shareHelp").hidden=false;
  const r=document.createRange();r.selectNodeContents($("shareText"));const s=getSelection();s.removeAllRanges();s.addRange(r);
  $("shareText").scrollIntoView({block:"nearest"});
}
function copyShare(t){
  const done=()=>shareLabel("Copied!"),fail=()=>{if(legacyCopy(t))done();else showShareText()};
  try{navigator.clipboard.writeText(t).then(done,fail)}catch(e){fail()}
}
$("copy").addEventListener("click",()=>{
  const t=$("shareText").textContent;
  if(navigator.share&&matchMedia("(pointer:coarse)").matches){
    // Copy first, in the same tap, so the result is on the clipboard even if the share sheet is cancelled.
    // execCommand runs synchronously and leaves the tap free for the share sheet; the clipboard API is the backup.
    let copied=legacyCopy(t);
    if(!copied)try{navigator.clipboard.writeText(t).then(()=>copied=true,()=>{})}catch(e){}
    const after=()=>{if(copied)shareLabel("Copied!")};
    // A cancelled share sheet is the player's choice; any other failure falls back to copying.
    try{navigator.share({text:t}).then(after,e=>{if(!e||e.name!=="AbortError")copyShare(t);else after()})}catch(e){copyShare(t)}
  }else copyShare(t);
});

function start(m){
  mode=m; $("mDaily").setAttribute("aria-pressed",m==="daily"); $("mPractice").setAttribute("aria-pressed",m==="practice");
  closeResults(); $("reopen").hidden=true; resetShare();
  $("catSel").hidden=m!=="practice";
  load(m==="daily"?POOL[TODAY]:nextPractice());
}
// Practice deals items like a shuffled deck: every item in the category comes up once before any repeats.
// A product line (iPhone, Camry) counts as one item, so dozens of recent models don't crowd out the groceries.
const itemOf=r=>SERIES[r.si].line||SERIES[r.si].name;
let deck=[],deckCat=null,lastItem=null;
function nextPractice(){
  const c=$("catSel").value, P=c?POOL.filter(r=>SERIES[r.si].cat===c):POOL;
  if(c!==deckCat){deckCat=c;deck=[]}
  if(!deck.length){
    deck=[...new Set(P.map(itemOf))];
    for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]]}
    if(deck.length>1&&deck.at(-1)===lastItem)[deck[0],deck[deck.length-1]]=[deck[deck.length-1],deck[0]];
  }
  lastItem=deck.pop();
  // Within the item, older prices come up about three times in four, like the daily schedule: before 2010
  // when the item has any, otherwise the older half of its years.
  const R=P.filter(r=>itemOf(r)===lastItem).sort((a,b)=>a.y-b.y);
  const pre=R.filter(r=>r.y<2010),old=pre.length&&pre.length<R.length?pre:R.slice(0,Math.ceil(R.length/2));
  const from=Math.random()<.75?old:R.filter(r=>!old.includes(r));
  const pick=from.length?from:R;
  return pick[Math.floor(Math.random()*pick.length)];
}
// iOS/iPadOS Safari ignores overflow:hidden on <body> for touch scrolling, so pin the body in place
// with position:fixed while the pop-up is open and restore the scroll position afterwards.
let lockY=0;
function lockPage(){const r=document.documentElement;if(r.classList.contains("modal-open"))return;lockY=window.scrollY;
  Object.assign(document.body.style,{position:"fixed",top:-lockY+"px",left:"0",right:"0"});r.classList.add("modal-open")}
function unlockPage(){const r=document.documentElement;if(!r.classList.contains("modal-open"))return;r.classList.remove("modal-open");
  Object.assign(document.body.style,{position:"",top:"",left:"",right:""});window.scrollTo(0,lockY)}
// Guesses to win, like Wordle's distribution. It's rebuilt from the saved guesses of every daily this browser has
// finished (one save per day, so reloads and practice rounds never count), which also covers days played before
// the chart existed.
function winDist(){
  const dist=[0,0,0,0,0,0];
  for(let d=1;d<=DAY;d++){const sv=store.get(DAYKEY+d,null);if(!sv||!Array.isArray(sv.g))continue;
    const p=POOL[roundOf(d)].p,n=sv.g.findIndex(g=>hitFor(g,p));if(n>=0&&n<MAXG)dist[n]++}
  return dist;
}
// "Next item in 5h 12m": the next daily starts at the player's local midnight, like the day number does.
function tickNext(){
  const n=new Date(),left=Math.max(0,new Date(n.getFullYear(),n.getMonth(),n.getDate()+1)-n),t=Math.floor(left/1000);
  $("nextIn").textContent=[t/3600,t%3600/60,t%60].map(v=>String(Math.floor(v)).padStart(2,"0")).join(":");
}
setInterval(()=>{if($("result").open&&!$("next").hidden)tickNext()},1000);
// Closing bell: the actual price counts up like a quote before it settles, then flashes green or red.
function closingBell(el,p,win){
  if(matchMedia("(prefers-reduced-motion:reduce)").matches)return;
  const t0=performance.now(),dur=1100;el.classList.remove("bell","win","lose");
  (function step(t){const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);
    el.textContent=fmt(k<1?p*e:p);
    if(k<1)requestAnimationFrame(step);else{void el.offsetWidth;el.classList.add("bell",win?"win":"lose")}})(t0);
}
function openResults(){const d=$("result");if(d.open)return;lockPage();if(d.showModal)d.showModal();else d.setAttribute("open","");
  // Enter then shares (or deals the next practice round) instead of closing the pop-up.
  (mode==="practice"?$("again"):$("copy")).focus({preventScroll:true})}
function closeResults(){const d=$("result");if(d.open&&d.close)d.close();else d.removeAttribute("open");unlockPage()}
// Touches outside the pop-up (e.g. dragging the page near the top) must not scroll or bounce the page.
document.addEventListener("touchmove",e=>{if(document.documentElement.classList.contains("modal-open")&&!$("result").contains(e.target)&&!$("help").contains(e.target))e.preventDefault()},{passive:false});
$("closeRes").onclick=closeResults;
// Escape key closes the dialog natively; keep the page lock in sync.
$("result").addEventListener("close",unlockPage);
$("showRes").onclick=openResults;
// How to play lives in its own pop-up, opened from the footer link, so the game screen stays short.
function closeHelp(){const d=$("help");if(d.open&&d.close)d.close();else d.removeAttribute("open");unlockPage()}
$("howLink").onclick=e=>{e.preventDefault();const d=$("help");if(d.open)return;lockPage();if(d.showModal)d.showModal();else d.setAttribute("open","");$("gotIt").focus({preventScroll:true})};
$("closeHelp").onclick=$("gotIt").onclick=closeHelp;
$("help").addEventListener("close",unlockPage);
$("help").addEventListener("click",e=>{if(e.target===$("help"))closeHelp()});
$("result").addEventListener("click",e=>{if(e.target===$("result"))closeResults()});
$("mDaily").onclick=()=>start("daily");
$("mPractice").onclick=()=>start("practice");
$("again").onclick=()=>start("practice");
$("skip").onclick=()=>start("practice");
// Keys: N deals the next practice round, R reopens a finished round's results. Ignored while typing a bid.
document.addEventListener("keydown",e=>{
  if(e.metaKey||e.ctrlKey||e.altKey||e.target.matches("input,select,textarea")||$("help").open)return;
  const k=e.key.toLowerCase();
  if(k==="n"&&mode==="practice"){e.preventDefault();start("practice")}
  else if(k==="r"&&done&&!$("result").open){e.preventDefault();openResults()}
});
$("catSel").onchange=()=>start("practice");

// Country picker: shown once at least one country file is listed in data/countries/index.json.
const COUNTRIES=[{code:"us",name:"United States",flag:"🇺🇸"},...(Array.isArray(LIST)?LIST:[])];
if(COUNTRIES.length>1){
  $("ctySel").innerHTML=COUNTRIES.map(c=>`<option value="${c.code}"${c.code===COUNTRY?" selected":""}>${c.flag} ${c.code.toUpperCase()}</option>`).join("");
  $("ctySel").hidden=false;
  $("ctySel").onchange=()=>{const c=$("ctySel").value;try{localStorage.setItem("ic-country",c)}catch(e){}location.href=location.pathname+(c==="us"?"":"?c="+c)};
}
if(!US){
  // Copy that names U.S. dollars or U.S. sources switches to this country's.
  const sym=DATA.symbol||money(0,0).replace(/[\d\s.,]/g,"");
  $("curLbl").textContent=sym; $("guess").placeholder=CUR.decimals?"0.00":"0"; $("guess").dataset.lbl="Your price guess in "+DATA.currencyName;$("guess").setAttribute("aria-label",$("guess").dataset.lbl);
  $("zone").textContent="Within 5% or "+money(CUR.hitMin,CUR.decimals);
  $("howPlay").textContent=`Guess what the item cost in ${DATA.name} that month, in ${DATA.currencyName}. You get six bids. Each miss tells you to go higher or lower and how close you were. Land within 5% of the target price to win.`;
  $("howSrc").textContent=DATA.about;
  $("catSel").innerHTML=`<option value="">All goods</option>`+[...new Set(SERIES.map(s=>s.cat))].map(c=>`<option>${c}</option>`).join("");
  document.title="Inflationdle "+DATA.name+": Daily Price Guessing Game";
}
tape(); start("daily");
}).catch(()=>{document.getElementById("item").textContent="Could not load prices. Refresh to try again.";document.getElementById("form").hidden=true});
