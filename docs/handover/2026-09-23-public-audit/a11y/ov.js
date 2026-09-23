const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const u of ['/pl/praca','/nl/praca','/nl/poradniki','/pl/poradniki']){const p=await br.newPage({viewport:{width:640,height:800}});await p.goto('http://localhost:3100'+u);await p.waitForTimeout(700);
 await p.evaluate(()=>document.documentElement.style.fontSize='200%');await p.waitForTimeout(300);
 const r=await p.evaluate(()=>{const W=document.documentElement.clientWidth;const out=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>W+1&&r.width>0&&![...e.children].some(c=>c.getBoundingClientRect().right>W+1)){out.push({html:e.outerHTML.slice(0,160),right:Math.round(r.right),inBanner:!!e.closest('[aria-labelledby="cookie-banner-title"]'),parent:e.parentElement.outerHTML.slice(0,160)})}});return {W,sw:document.documentElement.scrollWidth,out:out.slice(0,5)}});
 console.log(u,JSON.stringify(r,null,1));
 const b=p.locator('[aria-labelledby="cookie-banner-title"] button').first();if(await b.count()){await b.click();await p.waitForTimeout(300)}
 console.log(' after close sw-W', await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
 await p.close()}
await br.close()})();
