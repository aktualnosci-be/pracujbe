const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for (const vw of [1280,320]) { const pg=await br.newPage({viewport:{width:vw,height:800}});
await pg.goto('http://localhost:3100/pl/regulamin',{waitUntil:'networkidle'});
const out=[];
for(let i=0;i<40;i++){await pg.keyboard.press('Tab'); const r=await pg.evaluate(()=>{const e=document.activeElement;const b=e.getBoundingClientRect();const ban=document.querySelector('[aria-labelledby=cookie-banner-title]');if(!ban||ban.contains(e))return null;const bb=ban.getBoundingClientRect();const cov=Math.max(0,Math.min(b.bottom,bb.bottom)-Math.max(b.top,bb.top));return cov>0?(e.textContent.trim().slice(0,25)+' covered '+Math.round(cov)+'/'+Math.round(b.height)+'px'):null}); if(r) out.push(r);}
console.log(vw,out); await pg.close();}
await br.close();})();
