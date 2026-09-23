const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}}); const p=await ctx.newPage();
 await p.goto(B+'/pl/rejestracja'); await p.waitForLoadState('networkidle');
 for(let i=0;i<14;i++){ await p.keyboard.press('Tab'); 
  const r=await p.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);const b=e.getBoundingClientRect();
   return (e.id||e.tagName)+':'+(e.textContent||'').trim().slice(0,25)+' | outline='+cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor+' | shadow='+cs.boxShadow.slice(0,80)+' | y='+Math.round(b.top)+' h='+Math.round(b.height)});
  console.log(i,r);
  if(i<3) await p.screenshot({path:`tab${i}.png`,clip:{x:400,y:0,width:500,height:200}});
 }
 await br.close();
})();
