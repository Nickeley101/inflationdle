// Light/dark choice. Dark is the default look; light is opt-in with the sun/moon button and remembered in this
// browser. Loaded in <head> without defer so the page never flashes the wrong theme.
(function(){
  const K="ic-theme",root=document.documentElement;
  let t="dark";try{if(localStorage.getItem(K)==="light")t="light"}catch(e){}
  const apply=v=>{root.setAttribute("data-theme",v);
    const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=v==="light"?"#eef1f5":"#0a0e13";
    const b=document.getElementById("themeBtn");if(b){b.setAttribute("aria-pressed",String(v==="light"));b.setAttribute("aria-label",v==="light"?"Switch to dark mode":"Switch to light mode")}};
  apply(t);
  document.addEventListener("DOMContentLoaded",()=>{apply(t);const b=document.getElementById("themeBtn");if(!b)return;
    b.addEventListener("click",()=>{t=t==="light"?"dark":"light";apply(t);try{localStorage.setItem(K,t)}catch(e){}})});
})();
