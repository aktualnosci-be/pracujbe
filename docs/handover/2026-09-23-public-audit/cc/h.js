const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:640,height:800}});
 const pg=await ctx.newPage();
 await pg.goto('http://localhost:3100/nl/praca',{waitUntil:'networkidle'});
 await pg.locator('[aria-labelledby=cookie-banner-title] button').first().click(); await pg.waitForTimeout(300);
 for (const u of ['/nl/praca','/pl/praca','/fr/praca','/en/praca']) {
 await pg.goto('http://localhost:3100'+u,{waitUntil:'networkidle'});
 await pg.evaluate(()=>document.documentElement.style.fontSize='200%'); await pg.waitForTimeout(200);
 const r=await pg.evaluate(()=>{const cw=document.documentElement.clientWidth;const o=[];document.querySelectorAll('body *').forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&b.right>cw+1){o.push(e.tagName+'.'+(e.className+'').slice(0,50)+' "'+e.textContent.trim().slice(0,30)+'" r='+Math.round(b.right))}});return {sw:document.documentElement.scrollWidth,banner:!!document.querySelector('[aria-labelledby=cookie-banner-title]'),o:o.slice(0,5)}});
 console.log(u,JSON.stringify(r));
 }
 await br.close();
})();
