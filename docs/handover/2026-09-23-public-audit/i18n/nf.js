const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage();
await p.goto(`http://localhost:3100/nl/bestaat-niet`);
console.log(JSON.stringify(await p.evaluate(()=>({lang:document.documentElement.getAttribute('lang'),text:document.body.innerText,header:!!document.querySelector('header'),links:document.querySelectorAll('a').length}))));
await p.screenshot({path:'nf-nl.png'});await b.close();})();
