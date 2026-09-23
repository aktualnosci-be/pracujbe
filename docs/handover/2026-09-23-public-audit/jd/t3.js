const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
const B='http://localhost:3100';
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await (await br.newContext({viewport:{width:1280,height:900}})).newPage();
 p.on('console',m=>console.log('CONSOLE',m.type(),m.text().slice(0,200)));
 p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,200)));
 p.on('response',async r=>{if(r.request().method()==='POST'){console.log('RESP',r.status(),(await r.text().catch(()=>"?")).slice(0,300))}});
 await p.goto(`${B}/pl/oferty-pracy/bricklayer-brussels-1002`,{waitUntil:'networkidle'});
 await p.locator('button:visible',{hasText:'Aplikuj teraz'}).first().click(); await p.waitForTimeout(400);
 await p.fill('#apply-phone','470123456'); await p.click('#apply-consent');
 await p.locator('[role=dialog] button[type=submit]').click();
 await p.waitForTimeout(3000);
 console.log('disabled after:',await p.locator('[role=dialog] button[type=submit]').isDisabled(), await p.locator('[role=dialog] button[type=submit]').textContent());
 console.log('alert',await p.locator('[role=alert]').allTextContents());
 await br.close();
})();
