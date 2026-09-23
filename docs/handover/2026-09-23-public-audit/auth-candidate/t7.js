const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,h] of [[1280,900],[390,844],[1366,768]]){
 const ctx=await br.newContext({viewport:{width:w,height:h}}); const p=await ctx.newPage();
 for (const path of ['/pl/rejestracja','/pl/logowanie']){
 await p.goto(B+path); await p.waitForLoadState('networkidle');
 const out=[];
 for(let i=0;i<12;i++){ await p.keyboard.press('Tab'); await p.waitForTimeout(80);
  const r=await p.evaluate(()=>{const e=document.activeElement;const b=e.getBoundingClientRect();
    const ban=[...document.querySelectorAll('body *')].find(x=>getComputedStyle(x).position==='fixed'&&x.getBoundingClientRect().height>40&&!x.contains(e));
    if(!ban) return null; const c=ban.getBoundingClientRect();
    const ov=Math.max(0,Math.min(b.bottom,c.bottom)-Math.max(b.top,c.top));
    return ov>0?{el:(e.id||e.textContent.trim().slice(0,30)),top:Math.round(b.top),bottom:Math.round(b.bottom),banTop:Math.round(c.top),fully:b.top>=c.top&&b.bottom<=c.bottom}:null;});
  if(r){out.push(r); if(out.length===1) await p.screenshot({path:`obscured-${w}${path.replace(/\//g,'_')}.png`});}
 }
 console.log(w,h,path,JSON.stringify(out));
 }
 await ctx.close();}
 await br.close();
})();
