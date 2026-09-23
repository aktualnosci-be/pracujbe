const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const [u,w,fs] of [['/fr',768,'200%'],['/pl',768,'200%'],['/fr',1024,'200%'],['/nl',900,'200%'],['/fr',768,'100%'],['/fr',1280,'200%']]){const p=await br.newPage({viewport:{width:w,height:800}});await p.goto('http://localhost:3100'+u);await p.waitForTimeout(500);
 const b=p.locator('[aria-labelledby="cookie-banner-title"] button').first();if(await b.count()){await b.click();await p.waitForTimeout(200)}
 await p.evaluate(f=>document.documentElement.style.fontSize=f,fs);await p.waitForTimeout(200);
 const r=await p.evaluate(()=>{const W=document.documentElement.clientWidth;const out=[];document.querySelectorAll('header *').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>W+1)out.push(e.tagName+'.'+String(e.className).slice(0,60)+' "'+e.textContent.trim().slice(0,30)+'" R'+Math.round(r.right))});
  const vis=[...document.querySelectorAll('header a, header button')].map(e=>{const r=e.getBoundingClientRect();return r.width? (e.textContent.trim()||e.getAttribute('aria-label')).slice(0,20)+'@'+Math.round(r.left)+'-'+Math.round(r.right):null}).filter(Boolean);
  return {sw:document.documentElement.scrollWidth-W,out:out.slice(0,6),vis}});
 console.log(u,w,fs,JSON.stringify(r));await p.screenshot({path:`hdr-${u.slice(1)}-${w}-${fs.replace('%','')}.png`,clip:{x:0,y:0,width:w,height:140}});await p.close()}
await br.close()})();
