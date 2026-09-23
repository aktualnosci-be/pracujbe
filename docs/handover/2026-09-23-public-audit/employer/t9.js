const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100'; const {dismiss}=require('./common');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,path] of [[1280,'/pl/rejestracja-pracodawca'],[1280,'/pl'],[320,'/pl']]) {
 const ctx=await br.newContext({viewport:{width:w,height:800}}); const p=await ctx.newPage();
 await p.goto(B+path); await dismiss(p); await p.waitForTimeout(300);
 await p.evaluate(()=>document.activeElement.blur()); await p.mouse.click(5,300);
 const out=[];
 for(let i=0;i<(path==='/pl'?14:14);i++){ await p.keyboard.press('Tab'); out.push(await p.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return `${e.tagName}${e.id?'#'+e.id:''} "${(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,28)}" ${Math.round(r.width)}x${Math.round(r.height)} outline=${cs.outlineStyle}/${cs.outlineWidth} shadow=${cs.boxShadow==='none'?'none':'yes'}`}));}
 console.log(w,path); out.forEach(o=>console.log('  ',o));
 await ctx.close();}
 await br.close();
})();
