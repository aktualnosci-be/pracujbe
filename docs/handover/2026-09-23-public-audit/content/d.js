const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1280,height:900}});
 await ctx.addCookies([]);
 const pg=await ctx.newPage();
 await pg.goto(B+'/pl/poradniki',{waitUntil:'networkidle'});
 // accept necessary cookies to clear banner
 const bt=pg.getByRole('button',{name:/niezbędne|Tylko/i}).first(); if(await bt.count()) await bt.click();
 const seq=[];
 for(let i=0;i<30;i++){await pg.keyboard.press('Tab'); seq.push(await pg.evaluate(()=>{const e=document.activeElement;const cs=getComputedStyle(e);const card=e.closest('article');return (e.tagName+':'+(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,35)+' outline='+cs.outlineStyle+'/'+cs.outlineWidth+' shadow='+(cs.boxShadow!=='none')+(card?' cardShadow='+(getComputedStyle(card).boxShadow!=='none'):''))}));}
 console.log(seq.join('\n'));
 // focus a card and screenshot
 await pg.goto(B+'/pl/poradniki',{waitUntil:'networkidle'});
 await pg.locator('article a').first().focus(); await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Tab');
 await pg.locator('article').first().screenshot({path:'card-focus.png'});
 // targets on article page 320
 await pg.setViewportSize({width:320,height:800});
 await pg.goto(B+'/pl/poradniki/umowa-interim-co-warto-wiedziec',{waitUntil:'networkidle'});
 console.log(await pg.evaluate(()=>[...document.querySelectorAll('main a, main button')].map(a=>{const b=a.getBoundingClientRect();return a.textContent.trim().slice(0,30)+' '+Math.round(b.width)+'x'+Math.round(b.height)}).join('\n')));
 console.log('aria-current', await pg.evaluate(()=>document.querySelectorAll('[aria-current]').length));
 await pg.screenshot({path:'article-320.png'});
 await br.close();
})();
