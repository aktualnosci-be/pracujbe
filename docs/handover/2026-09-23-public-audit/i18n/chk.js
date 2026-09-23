const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
for(const l of ['nl','fr']){
await p.goto(`http://localhost:3100/${l}/rejestracja`);await p.waitForTimeout(800);
await p.locator('input[type=email]').first().fill('abc');await p.locator('form button[type=submit]').first().click();await p.waitForTimeout(800);
console.log(l,await p.$$eval('[role=alert],[id$=-error],p.text-destructive,[aria-invalid=true]',e=>e.map(x=>x.tagName+':'+String(x.textContent||x.getAttribute('name')).trim().slice(0,70))));
await p.goto(`http://localhost:3100/${l}/oferty-pracy/fruit-picker-hasselt-1011`);
console.log(l,'buttons',(await p.$$eval('main button, main a',e=>e.map(x=>x.innerText.trim()).filter(Boolean))).slice(0,15));}
await b.close();})();
