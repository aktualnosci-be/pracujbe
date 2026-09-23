const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await br.newPage({viewport:{width:1280,height:800}});await p.goto('http://localhost:3100/pl/oferty-pracy');await p.waitForTimeout(800);
await p.keyboard.press('Tab');await p.waitForTimeout(400);await p.keyboard.press('Tab');
for(const ms of [0,100,200,400]){await p.waitForTimeout(ms? ms-(ms>100?100:0):0);console.log(ms,await p.evaluate(()=>{const e=document.activeElement;const r=e.getBoundingClientRect();const h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e.textContent.trim()+' hit:'+(e.contains(h)?'self':h.outerHTML.slice(0,60))}))}
// banner tab position
const order=[];await p.goto('http://localhost:3100/pl/oferty-pracy');await p.waitForTimeout(800);
for(let i=0;i<60;i++){await p.keyboard.press('Tab');const t=await p.evaluate(()=>({b:!!document.activeElement.closest('[aria-labelledby="cookie-banner-title"]'),t:document.activeElement.textContent.trim().slice(0,25)}));order.push((t.b?'[B]':'')+t.t)}
console.log(order.map((x,i)=>i+1+':'+x).join(' | '));
// Shift+Tab from start
await p.goto('http://localhost:3100/pl/oferty-pracy');await p.waitForTimeout(800);await p.keyboard.press('Shift+Tab');console.log('shift-tab first:',await p.evaluate(()=>document.activeElement.textContent.trim().slice(0,30)));
console.log('DOM pos banner:', await p.evaluate(()=>{const b=document.querySelector('[aria-labelledby="cookie-banner-title"]');const m=document.querySelector('main');return m.compareDocumentPosition(b)&4?'after main':'before main'}));
await br.close()})();
