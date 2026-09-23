const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await br.newContext({serviceWorkers:'allow'});const p=await ctx.newPage();
await p.goto('http://localhost:3100/pl');await p.waitForTimeout(4000);
console.log(await p.evaluate(async()=>({regs:(await navigator.serviceWorker.getRegistrations()).length,ctrl:!!navigator.serviceWorker.controller, ready:document.readyState})));
await br.close();})();
