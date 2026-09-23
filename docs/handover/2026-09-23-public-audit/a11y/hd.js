const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for(const [u,w] of [['/pl/oferty-pracy',320],['/pl/oferty-pracy',1280],['/pl/praca/kategoria/construction',1280],['/pl/logowanie',1280],['/pl/rejestracja',1280],['/pl/reset-hasla',1280],['/pl/rejestracja-pracodawca',1280]]){const p=await br.newPage({viewport:{width:w,height:800}});await p.goto('http://localhost:3100'+u);await p.waitForTimeout(600);
 console.log(u,w,await p.evaluate(()=>[...document.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').slice(0,8).map(e=>e.tagName+':'+e.textContent.trim().slice(0,30)).join(' | ')+' || title-like: '+[...document.querySelectorAll('main [class*="font-semibold"]')].slice(0,1).map(e=>e.tagName+':'+e.textContent.trim().slice(0,30))));await p.close()}
await br.close()})();
