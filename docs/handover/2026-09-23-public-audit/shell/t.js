const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await br.newPage();
await p.goto('http://localhost:3207/pl/poradniki/nie-ma');await p.waitForTimeout(1500);
console.log(await p.evaluate(()=>[...document.querySelectorAll('title')].map(t=>t.textContent+'@'+t.parentElement.tagName)), await p.evaluate(()=>[...document.querySelectorAll('meta[name=robots]')].map(m=>m.content)));await br.close();})();
