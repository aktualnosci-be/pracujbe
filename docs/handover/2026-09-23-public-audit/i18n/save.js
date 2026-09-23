const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
p.on('console',m=>{if(m.type()==='error')console.log('console',m.text().slice(0,150))});
await p.goto(`http://localhost:3100/en/oferty-pracy/fruit-picker-hasselt-1011`);await p.waitForTimeout(4000);
console.log((await p.$$eval('main button',e=>e.map(x=>(x.innerText.trim()||x.getAttribute('aria-label'))+' disabled='+x.disabled))).join('\n'));
await b.close();})();
