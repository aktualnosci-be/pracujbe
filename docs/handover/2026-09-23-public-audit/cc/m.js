const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}});
 const pg=await ctx.newPage();
 await pg.goto('http://localhost:3100/pl/praca',{waitUntil:'networkidle'});
 await pg.locator('[aria-labelledby=cookie-banner-title] button').first().click();
 for (const u of ['/pl/praca','/pl/praca/miasto/ghent']) {
 await pg.goto('http://localhost:3100'+u,{waitUntil:'networkidle'});
 const seen=[];
 for(let i=0;i<45;i++){ await pg.keyboard.press('Tab');
  const f=await pg.evaluate(()=>{const e=document.activeElement;if(!e||!e.closest('main'))return null;const cs=getComputedStyle(e);const b=e.getBoundingClientRect();return {t:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,25),outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,shadow:cs.boxShadow.slice(0,40),h:Math.round(b.height),top:Math.round(b.top)}});
  if(f) seen.push(f);}
 console.log(u); seen.forEach(s=>console.log(' ',JSON.stringify(s)));
 }
 await br.close();
})();
