const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 for (const [w,h,fs,loc] of [[320,640,null,'fr'],[640,800,'200%','pl']]){
 const p=await (await br.newContext({viewport:{width:w,height:h}})).newPage();
 await p.goto(`${B}/${loc}/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
 const cb=p.locator('[role=dialog] button, div button').filter({hasText:/Tout accepter|Akceptuj wszystkie/}); if(await cb.count()) await cb.first().click();
 if(fs) await p.evaluate(f=>document.documentElement.style.fontSize=f,fs);
 await p.locator('div.fixed.inset-x-0.bottom-0 button').last().click(); await p.waitForTimeout(500);
 const r=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');const b=d.getBoundingClientRect();const over=[...d.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>b.right+1||r.left<b.left-1)}).map(e=>e.tagName+':'+e.textContent.trim().slice(0,30)+' '+Math.round(e.getBoundingClientRect().right)+'>'+Math.round(b.right));return {dlg:[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)],sh:d.scrollHeight,ch:d.clientHeight,sw:d.scrollWidth,cw:d.clientWidth,over:over.slice(0,6)}});
 console.log(w,fs,loc,JSON.stringify(r));
 await p.screenshot({path:`dlg-${w}.png`});
 await p.fill('#apply-phone','1'); await p.locator('[role=dialog] button[type=submit]').scrollIntoViewIfNeeded(); await p.locator('[role=dialog] button[type=submit]').click(); await p.waitForTimeout(600);
 await p.screenshot({path:`dlg-${w}-err.png`});
 }
 await br.close();
})();
