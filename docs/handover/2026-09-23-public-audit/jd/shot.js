const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for (const w of [375,1280]){const p=await (await br.newContext({viewport:{width:w,height:800}})).newPage();
await p.goto('http://localhost:3204/pl/oferty-pracy/bricklayer-brussels-1002',{waitUntil:'networkidle'});
const el=p.locator('dl').nth(1); await el.scrollIntoViewIfNeeded(); await el.screenshot({path:`dl-${w}.png`});}
await br.close();})();
