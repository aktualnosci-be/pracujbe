const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await (await br.newContext({viewport:{width:1280,height:900}})).newPage();
 const bodies=[];
 await p.route('**/*',async route=>{const req=route.request();if(req.method()==='POST'&&req.headers()['next-action']){const resp=await route.fetch();const t=await resp.text();bodies.push(req.postData().slice(0,120)+' => '+t.slice(-200));return route.fulfill({response:resp,body:t});}return route.continue();});
 await p.goto('http://localhost:3100/pl/oferty-pracy/bricklayer-brussels-1002',{waitUntil:'networkidle'});
 for (const ph of ['abc','470123456']){
 await p.locator('button:visible',{hasText:'Aplikuj teraz'}).first().click(); await p.waitForTimeout(300);
 await p.fill('#apply-phone',ph); await p.click('#apply-consent');
 bodies.length=0;
 await p.locator('[role=dialog] button[type=submit]').click(); await p.waitForTimeout(1500);
 console.log(ph,'alert=',await p.locator('[role=dialog] [role=alert]').textContent().catch(()=>null),'phone aria-invalid=',await p.getAttribute('#apply-phone','aria-invalid'));
 console.log(bodies.filter(b=>b.includes('phone')).join('\n'));
 await p.keyboard.press('Escape'); await p.waitForTimeout(300);
 }
 await br.close();
})();
