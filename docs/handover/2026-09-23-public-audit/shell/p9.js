const { chromium } = require('/workspace/pracujbe/node_modules/playwright');
(async()=>{
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const p=await br.newPage({viewport:{width:320,height:640}});
 await p.goto('http://localhost:3100/fr/oferty-pracy');await p.waitForTimeout(800);
 await p.locator('header button[aria-haspopup=dialog]').click();await p.waitForTimeout(400);
 console.log(await p.locator('[role=dialog]').ariaSnapshot());
 console.log(await p.locator('header').first().evaluate(h=>h.closest('[aria-hidden]')?'header aria-hidden':'header exposed'));
 await br.close();
})();
