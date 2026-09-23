const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await br.newPage();
p.on('console',m=>console.log('console',m.type(),m.text().slice(0,400)));p.on('pageerror',e=>console.log('pageerror',e.message.slice(0,400)));
await p.goto('http://localhost:3207/pl/poradniki/nie-ma');await p.waitForTimeout(2000);await br.close();})();
